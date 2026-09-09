/* 农险气象预测-气象指数保险耦合 · 前端逻辑（多期次支持） */
const PW = "nongxian2026";
const LEVEL_COLOR = { "极高": "#ff4d4f", "高": "#ff7a45", "中": "#ffc53d", "低": "#52c41a" };
const LEVEL_IDX = { "极低": 0, "低": 1, "中": 2, "高": 3, "极高": 4 };
const LEVEL_ORDER = ["极高", "高", "中", "低"];

let DATA = null;          // reports.json
let CHINA = null;         // china geojson
let curPeriod = "";       // 当前期次（baseDate）
let curFilterProv = "", curFilterLevel = "", curSearch = "";
let charts = {};
/* 地图三级下钻状态 */
let mapLevel = "china";   // 'china' | 'prov' | 'city'
let curProv = null;       // {adcode, name}
let curCity = null;       // {adcode, name}
let mapMode = "risk";     // 'risk' | 'ins'
const INS_COLOR = { 0:"#46506a", 1:"#5b9bd5", 2:"#2f7fd1", 3:"#1c5fb0" };
/* 附件基址：GitHub Pages 精简版不含 reports/，自动指向原站取附件；本地/原站部署仍用相对路径 */
const ASSETS_BASE = location.host.endsWith(".github.io")
  ? "https://c12d944b49e34724a0ed76569c8b3110.app.workbuddy.link/"
  : "./";
function abs(u){ return /^https?:/.test(u) ? u : (ASSETS_BASE + String(u).replace(/^\.\//,"")); }
const geoCache = {};      // `${lvl}:${adcode}` -> geojson

/* 当前期次数据对象 */
function curData(){
  return DATA.periods.find(p => p.period === curPeriod) || DATA.periods[0];
}

/* ---------------- 登录 ---------------- */
let AUTHED = false;

/* doLogin 已内联至 index.html（登录不依赖本脚本加载） */

function logout(){
  sessionStorage.removeItem("nongxian_auth");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
}
function enterApp(){
  document.getElementById("login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  if(!DATA){ loadData(); }   // boot 加载层由 bootUI() 收尾时隐藏
}

/* ---------------- 数据加载 ---------------- */
async function loadData(){
  try{
    const [r1, r2] = await Promise.all([
      fetch("./data/reports.json"),
      fetch("./data/china.json")
    ]);
    DATA = await r1.json();
    try{ CHINA = await r2.json(); }catch(e){ CHINA = null; }
    curPeriod = DATA.meta.defaultPeriod || DATA.periods[0].period;
    bootUI();
  }catch(err){
    const b=document.getElementById("boot"); if(b) b.classList.add("hidden");
    const app=document.getElementById("app");
    app.innerHTML = `<div style="padding:60px 30px;text-align:center;color:var(--txt2)">
      <div style="font-size:40px;margin-bottom:14px">⚠️</div>
      <div style="font-size:15px;margin-bottom:8px">数据加载失败：${err.message}</div>
      <div style="font-size:12.5px;margin-bottom:18px">多为网络抖动（GitHub 静态资源偶发不可达），请稍后重试。</div>
      <button class="ghost-btn" onclick="location.reload()">↻ 重新加载</button></div>`;
  }
}

/* ---------------- UI 初始化 ---------------- */
function bootUI(){
  const b=document.getElementById("boot"); if(b) b.classList.add("hidden");
  buildPeriodFilter();
  document.getElementById("periodLabel").textContent = "基准 " + curPeriod;
  buildProvFilter();
  renderDashboard();
  renderList();
  renderInsurance();
  if(window.echarts && CHINA){ renderMap(); }
}

function buildPeriodFilter(){
  const sel = document.getElementById("periodFilter");
  if(!sel) return;
  sel.innerHTML = DATA.periods
    .slice().sort((a,b)=>a.period.localeCompare(b.period))
    .map(p=>`<option value="${p.period}">${p.periodLabel}</option>`).join("");
  sel.value = curPeriod;
  sel.onchange = ()=>switchPeriod(sel.value);
}

function switchPeriod(period){
  curPeriod = period;
  const d = curData();
  document.getElementById("periodLabel").textContent = "基准 " + curPeriod;
  // 重置筛选
  curFilterProv = ""; curFilterLevel = ""; curSearch = "";
  const sf = document.getElementById("searchBox"); if(sf) sf.value = "";
  const lf = document.getElementById("levelFilter"); if(lf) lf.value = "";
  buildProvFilter();
  renderDashboard();
  renderList();
  renderInsurance();
  mapLevel = "china"; curProv = null; curCity = null;   // 期次切换重置下钻
  if(window.echarts && CHINA){ renderMap(); }
  if(window.echarts){
    setTimeout(()=>{ Object.values(charts).forEach(c=>{ try{c.resize();}catch(e){} }); }, 60);
  }
}

function buildProvFilter(){
  const sel = document.getElementById("provFilter");
  sel.innerHTML = '<option value="">全部省份</option>' +
    Object.keys(curData().provinces).map(p=>`<option value="${p}">${p}（${curData().provinces[p]}）</option>`).join("");
}

/* ---------------- 视图切换 ---------------- */
function switchView(v){
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.view===v));
  document.querySelectorAll(".view").forEach(s=>s.classList.add("hidden"));
  document.getElementById("view-"+v).classList.remove("hidden");
  if(v==="dashboard" && window.echarts){
    setTimeout(()=>{ Object.values(charts).forEach(c=>{ try{c.resize();}catch(e){} }); }, 60);
  }
  if(v==="eval"){ renderEval(); }
  if(v==="couple"){ renderCouple(); }
}

/* ---------------- 风险大屏 ---------------- */
function renderDashboard(){
  const s = curData().summary;
  const kpis = [
    {cls:"tot", num:curData().total, lbl:"覆盖县域（个）"},
    {cls:"ext", num:s["极高"]||0, lbl:"极高等级"},
    {cls:"high", num:s["高"]||0, lbl:"高等级"},
    {cls:"mid", num:s["中"]||0, lbl:"中等级"},
    {cls:"low", num:s["低"]||0, lbl:"低等级"},
  ];
  document.getElementById("kpiRow").innerHTML = kpis.map(k=>`
    <div class="kpi ${k.cls}"><div class="bar"></div><div class="num">${k.num}</div><div class="lbl">${k.lbl}</div></div>`).join("");

  document.getElementById("mapLegend").innerHTML = LEVEL_ORDER.map(l=>
    `<span><i style="background:${LEVEL_COLOR[l]}"></i>${l}</span>`).join("");

  renderDonut();
  renderProvBar();
  renderTopList();
  renderWinTimeline();
}

function renderWinTimeline(){
  const counties = curData().counties;
  const w0 = counties[0] && counties[0].windows;
  const box = document.getElementById("winTimeline");
  if(!box) return;
  if(!w0){ box.innerHTML=""; return; }
  const N = w0.length;
  const stats = Array.from({length:N},()=>({lv:{极高:0,高:0,中:0,低:0}, hz:{}}));
  counties.forEach(c=>{
    (c.windows||[]).forEach((w,i)=>{
      if(i>=N) return;
      stats[i].lv[w.level]=(stats[i].lv[w.level]||0)+1;
      const h=w.hazard||"";
      h.split(/[、/]/).forEach(x=>{x=x.trim(); if(x) stats[i].hz[x]=(stats[i].hz[x]||0)+1;});
    });
  });
  const tot=counties.length;
  box.innerHTML = w0.map((w,i)=>{
    const s=stats[i];
    const topHz=Object.entries(s.hz).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k} ${v}`).join(" · ")||"—";
    const maxLv=["极高","高","中","低"].find(l=>s.lv[l]>0)||"低";
    const bars=["极高","高","中","低"].map(l=>{
      const pct=tot?Math.round((s.lv[l]||0)/tot*100):0;
      return `<div class="wbar"><i style="width:${pct}%;background:${LEVEL_COLOR[l]}"></i><b>${s.lv[l]||0}</b></div>`;
    }).join("");
    return `<div class="win-card">
      <div class="win-head"><span class="win-idx">窗口${i+1}</span><span class="win-name">${w.name}</span></div>
      <div class="win-period">${w.period}</div>
      <div class="win-lv"><span class="lv-badge lv-${maxLv}">峰值 ${maxLv}</span></div>
      <div class="win-bars">${bars}</div>
      <div class="win-hz">主要灾害<br><b>${topHz}</b></div>
    </div>`;
  }).join("");
}

function renderDonut(){
  if(!window.echarts) return;
  const el = document.getElementById("levelDonut");
  const chart = charts.donut || (charts.donut = echarts.init(el, null, {renderer:"canvas"}));
  const s = curData().summary;
  const data = LEVEL_ORDER.map(l=>({name:l, value:s[l]||0, itemStyle:{color:LEVEL_COLOR[l]}}));
  chart.setOption({
    tooltip:{trigger:"item", formatter:"{b}: {c} 县 ({d}%)"},
    series:[{type:"pie", radius:["45%","72%"], center:["50%","52%"],
      label:{color:"#e8eefc", formatter:"{b}\n{c}"}, labelLine:{lineStyle:{color:"#27395f"}},
      data, color:["#ff4d4f","#ff7a45","#ffc53d","#52c41a"]}]
  }, true);
}

function renderProvBar(){
  if(!window.echarts) return;
  const el = document.getElementById("provBar");
  const chart = charts.prov || (charts.prov = echarts.init(el, null, {renderer:"canvas"}));
  const arr = Object.entries(curData().provinces).sort((a,b)=>b[1]-a[1]);
  chart.setOption({
    grid:{left:6,right:14,top:10,bottom:6,containLabel:true},
    tooltip:{trigger:"axis", axisPointer:{type:"shadow"}},
    xAxis:{type:"value", axisLabel:{color:"#9fb2d4"}, splitLine:{lineStyle:{color:"#1c2c4a"}}},
    yAxis:{type:"category", data:arr.map(a=>a[0]), axisLabel:{color:"#9fb2d4", fontSize:11},
      axisLine:{lineStyle:{color:"#27395f"}}},
    series:[{type:"bar", data:arr.map(a=>a[1]), barWidth:"55%",
      itemStyle:{color:new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:"#f4a261"},{offset:1,color:"#e63946"}])},
      label:{show:true, position:"right", color:"#e8eefc"}}]
  }, true);
}

function renderTopList(){
  const sorted = [...curData().counties].sort((a,b)=>
    (LEVEL_IDX[b.overall]||0)-(LEVEL_IDX[a.overall]||0) || b.coord[1]-a.coord[1]);
  const top = sorted.filter(c=>c.overall==="极高"||c.overall==="高").slice(0,18);
  const more = sorted.slice(0,12);
  const list = top.length>=6?top:more;
  document.getElementById("topList").innerHTML = list.map(c=>`
    <div class="top-item" onclick="openDetail('${c.id}')">
      <span class="lv-dot" style="background:${LEVEL_COLOR[c.overall]}"></span>
      <span class="nm">${c.county}</span>
      <span class="hz">${c.province}·${c.windows[0]?c.windows[0].hazard:""}</span>
    </div>`).join("");
}

/* ---------------- 地图（省 → 市 → 县 三级下钻） ---------------- */
function rankOf(lv){ return ({"低":1,"中":2,"高":3,"极高":4}[lv]||0); }
function ofRank(r){ return ({1:"低",2:"中",3:"高",4:"极高"}[r]||"低"); }

async function fetchGeo(lvl, ad){
  const key = `${lvl}:${ad}`;
  if(geoCache[key]) return geoCache[key];
  const url = lvl==="china" ? "./data/china.json"
            : lvl==="prov"  ? `./data/geo/prov/${ad}.json`
            :                `./data/geo/city/${ad}.json`;
  const r = await fetch(url);
  const j = await r.json();
  geoCache[key] = j;
  return j;
}

function aggregate(scope){
  const counties = curData().counties.filter(c=>{
    if(scope.lvl==="china") return true;
    if(scope.lvl==="prov")  return c.geo && c.geo.prov.adcode===scope.provAd;
    if(scope.lvl==="city")  return c.geo && c.geo.city.adcode===scope.cityAd;
    return false;
  });
  const byName = {}, insByName = {};
  for(const c of counties){
    const nm = scope.lvl==="china" ? (c.geo&&c.geo.prov.name)
             : scope.lvl==="prov"  ? (c.geo&&c.geo.city.name)
             :                       (c.geo&&c.geo.county.name);
    if(!nm) continue;                       // 特殊区(无DataV边界)不参加面着色
    const r = rankOf(c.overall);
    if(!byName[nm] || r>byName[nm]) byName[nm]=r;
    const n = (c.insuranceHints||[]).length;
    if(n>(insByName[nm]||0)) insByName[nm]=n;
  }
  return {counties, byName, insByName};
}

function updateMapUI(){
  const back=document.getElementById("mapBack");
  const crumb=document.getElementById("mapCrumb");
  const hint=document.getElementById("mapHint");
  const modeNote = mapMode==="ins" ? "（蓝阶＝可匹配指数保险类别数 · " : "（红橙黄绿＝风险等级 · ";
  if(mapLevel==="china"){
    if(back) back.style.display="none";
    if(crumb) crumb.textContent="全国";
    if(hint) hint.textContent=modeNote+"点击省份下钻 · 点击散点看县域详情）";
  } else if(mapLevel==="prov"){
    if(back) back.style.display="";
    if(crumb) crumb.textContent=`全国 ▸ ${curProv.name}`;
    if(hint) hint.textContent=modeNote+"点击地级市下钻 · 点击散点看县域详情）";
  } else {
    if(back) back.style.display="";
    if(crumb) crumb.textContent=`全国 ▸ ${curProv.name} ▸ ${curCity.name}`;
    if(hint) hint.textContent=modeNote+"点击区县看详情）";
  }
}
function mapBack(){
  if(mapLevel==="city"){ mapLevel="prov"; curCity=null; }
  else if(mapLevel==="prov"){ mapLevel="china"; curProv=null; }
  updateMapUI(); renderMap();
}
function setMapMode(m){
  if(mapMode===m) return;
  mapMode=m;
  const tgR=document.getElementById("tgRisk"), tgI=document.getElementById("tgIns");
  if(tgR) tgR.classList.toggle("active", m==="risk");
  if(tgI) tgI.classList.toggle("active", m==="ins");
  updateMapUI(); renderMap();
}

function mapMsg(show){
  const l=document.getElementById("mapLoading"), e=document.getElementById("mapError");
  if(!l||!e) return;
  l.style.display = show==="loading" ? "flex" : "none";
  e.style.display = show==="error" ? "flex" : "none";
}
async function renderMap(){
  mapMsg("loading");
  if(!window.echarts || !CHINA){ mapMsg("error"); return; }
  try{ echarts.registerMap("china", CHINA); }catch(e){}
  const el = document.getElementById("chinaMap");
  const chart = charts.map || (charts.map = echarts.init(el, null, {renderer:"canvas"}));
  let mapName, scope;
  if(mapLevel==="china"){
    mapName="china"; scope={lvl:"china"};
  } else if(mapLevel==="prov"){
    try{
      const g = await fetchGeo("prov", curProv.adcode);
      mapName=`prov-${curProv.adcode}`; echarts.registerMap(mapName, g);
    }catch(e){ mapMsg("error"); return; }
    scope={lvl:"prov", provAd:curProv.adcode};
  } else {
    try{
      const g = await fetchGeo("city", curCity.adcode);
      mapName=`city-${curCity.adcode}`; echarts.registerMap(mapName, g);
    }catch(e){ mapMsg("error"); return; }
    scope={lvl:"city", cityAd:curCity.adcode};
  }
  const {counties, byName, insByName} = aggregate(scope);
  const regions = Object.entries(byName).map(([nm,r])=>{
    const lv=ofRank(r);
    const insN=insByName[nm]||0;
    const color = mapMode==="ins" ? INS_COLOR[Math.min(insN,3)] : LEVEL_COLOR[lv];
    return {name:nm, itemStyle:{color, opacity:.82}, label:{show:false},
      emphasis:{itemStyle:{color, borderColor:"#fff", borderWidth:1.5}}};
  });
  const sc = counties.filter(c=>c.coord).map(c=>{
    const n=(c.insuranceHints||[]).length;
    const v= mapMode==="ins" ? n : rankOf(c.overall);
    return {name:c.county, id:c.id, value:[c.coord[0], c.coord[1], v],
      itemStyle:{color: mapMode==="ins" ? INS_COLOR[Math.min(n,3)] : LEVEL_COLOR[c.overall]}};
  });
  chart.setOption({
    backgroundColor:"transparent",
    tooltip:{trigger:"item", formatter:p=>{
      if(p.componentType==="series" && p.data && p.data.id){
        const c=curData().counties.find(x=>x.id===p.data.id);
        if(!c) return "";
        if(mapMode==="ins") return `<b>${c.county}</b><br/>可匹配指数保险：<b style="color:#5b9bd5">${(c.insuranceHints||[]).join("、")||"无"}</b>`;
        return `<b>${c.county}</b><br/>${c.province}·${c.city}<br/>整体风险：<b style="color:${LEVEL_COLOR[c.overall]}">${c.overall}</b><br/>首窗灾害：${c.windows[0]?c.windows[0].hazard:"-"}`;
      }
      const r=byName[p.name];
      if(r){
        if(mapMode==="ins"){ const n=insByName[p.name]||0; return `<b>${p.name}</b><br/>区域内最多可匹配指数保险：<b style="color:#5b9bd5">${n}</b> 类<br/><span style="color:#9fb3d6">点击${mapLevel==="city"?"查看详情":"下钻"}</span>`; }
        return `<b>${p.name}</b><br/>风险等级：<b style="color:${LEVEL_COLOR[ofRank(r)]}">${ofRank(r)}</b><br/><span style="color:#9fb3d6">点击${mapLevel==="city"?"查看详情":"下钻"}</span>`;
      }
      return p.name;
    }},
    geo:{ map:mapName, roam:true, zoom: mapLevel==="china"?1.15:1.05,
      itemStyle:{areaColor:"#132b52", borderColor:"#41639c"},
      emphasis:{itemStyle:{areaColor:"#1b3a6d"}, label:{show:false}},
      label:{show:false}, regions },
    series:[{type:"scatter", coordinateSystem:"geo", data:sc,
      symbolSize:v=>{
        if(mapMode==="ins"){ const k=Math.min(v[2]||0,3); return [10,16,22,28][k]||12; }
        // 风险等级：低1/中2/高3/极高4 → 圆点随等级增大（极高最大 28）
        const k=(v[2]||0); return [8,12,17,22,28][k]||12;
      }, emphasis:{scale:1.4},
      itemStyle:{borderColor:"#fff", borderWidth:.5, opacity:.92}}]
  }, true);
  // 图例随模式切换
  const leg=document.getElementById("mapLegend");
  if(leg){
    leg.innerHTML = mapMode==="ins"
      ? `<span><i style="background:${INS_COLOR[0]}"></i>无匹配</span><span><i style="background:${INS_COLOR[1]}"></i>1类</span><span><i style="background:${INS_COLOR[2]}"></i>2类</span><span><i style="background:${INS_COLOR[3]}"></i>3类+</span>`
      : LEVEL_ORDER.map(l=>`<span><i style="background:${LEVEL_COLOR[l]}"></i>${l}</span>`).join("");
  }
  chart.off("click");
  chart.on("click", p=>{
    if(p.componentType==="series" && p.data && p.data.id){ openDetail(p.data.id); return; }
    const nm=p.name;
    if(mapLevel==="china"){
      const c=curData().counties.find(x=>x.geo&&x.geo.prov.name===nm);
      if(c){ curProv={adcode:c.geo.prov.adcode, name:nm}; mapLevel="prov"; updateMapUI(); renderMap(); }
    } else if(mapLevel==="prov"){
      const c=curData().counties.find(x=>x.geo&&x.geo.city.name===nm && x.geo.prov.adcode===curProv.adcode);
      if(c){ curCity={adcode:c.geo.city.adcode, name:nm}; mapLevel="city"; updateMapUI(); renderMap(); }
    } else if(mapLevel==="city"){
      const c=curData().counties.find(x=>x.geo&&x.geo.county.name===nm && x.geo.city.adcode===curCity.adcode);
      if(c) openDetail(c.id);
    }
  });
  updateMapUI();
  mapMsg("hide");
}

/* ---------------- 县域清单 ---------------- */
function filteredCounties(){
  return curData().counties.filter(c=>{
    if(curFilterProv && c.province!==curFilterProv) return false;
    if(curFilterLevel && c.overall!==curFilterLevel) return false;
    if(curSearch){
      const t = (c.province+c.city+c.county).toLowerCase();
      if(!t.includes(curSearch.toLowerCase())) return false;
    }
    return true;
  });
}
function renderList(){
  curSearch = document.getElementById("searchBox").value.trim();
  curFilterProv = document.getElementById("provFilter").value;
  curFilterLevel = document.getElementById("levelFilter").value;
  const rows = filteredCounties();
  // 省风险 = 该省所有县中 overall 最高等级；排序：省风险高→低 → 县风险高→低 → 省名
  const provMax = {};
  rows.forEach(c => {
    const r = LEVEL_IDX[c.overall]||0;
    if(r > (provMax[c.province]||0)) provMax[c.province] = r;
  });
  rows.sort((a,b)=>{
    const pr = (provMax[b.province]||0) - (provMax[a.province]||0);
    if(pr !== 0) return pr;
    const lr = (LEVEL_IDX[b.overall]||0) - (LEVEL_IDX[a.overall]||0);
    if(lr !== 0) return lr;
    return a.province.localeCompare(b.province);
  });
  const body = document.getElementById("countyBody");
  document.getElementById("listEmpty").classList.toggle("hidden", rows.length>0);
  body.innerHTML = rows.map(c=>{
    const hz = c.windows.map(w=>`${w.name}:${w.hazard}【${w.level}】`).join("、");
    return `<tr onclick="openDetail('${c.id}')" style="cursor:pointer">
      <td><div class="nm">${c.county}</div><div class="sub2">${c.province} · ${c.city}</div></td>
      <td class="sub2">${c.adcode||"-"}</td>
      <td><span class="lv-badge lv-${c.overall}">${c.overall}</span></td>
      <td class="sub2">${hz}</td>
      <td class="sub2">${(c.crops||[]).join("、")}</td>
      <td>
        <button class="mini-btn" onclick="event.stopPropagation();dl('${c.files.docx}')">报告</button>
        <button class="mini-btn" onclick="event.stopPropagation();dl('${c.files.md}')">MD</button>
        <button class="mini-btn" onclick="event.stopPropagation();packOne('${c.id}')">打包</button>
      </td>
    </tr>`;
  }).join("");
}

/* ---------------- 指数保险匹配 ---------------- */
function renderInsurance(){
  const cnt = {};
  curData().counties.forEach(c=>(c.insuranceHints||[]).forEach(i=>cnt[i]=(cnt[i]||0)+1));
  const chips = Object.entries(cnt).sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>`<span class="ins-chip">${k}：<b>${v}</b> 县</span>`).join("");
  document.getElementById("insSummary").innerHTML =
    `<div style="margin-bottom:8px;color:var(--txt2);font-size:12.5px">基于各县域四窗口主要气象灾害类型自动映射可匹配的天气指数保险产品（霜冻/降水/暴雨/连阴雨/高温/大风/干旱指数保险等），后续需结合标的、阈值、基差与精算校准后投产。</div>` + chips;
  const body = document.getElementById("insBody");
  // 匹配度 = insuranceHints.length（可匹配指数保险类别数），高→低；同分按风险等级
  const rows = [...curData().counties].sort((a,b)=>{
    const m = (b.insuranceHints||[]).length - (a.insuranceHints||[]).length;
    if(m !== 0) return m;
    return (LEVEL_IDX[b.overall]||0) - (LEVEL_IDX[a.overall]||0);
  });
  body.innerHTML = rows.map(c=>{
    const hz = [...new Set(c.windows.map(w=>w.hazard))].join("、");
    const n = (c.insuranceHints||[]).length;
    return `<tr onclick="openDetail('${c.id}')" style="cursor:pointer">
      <td><div class="nm">${c.county}</div><div class="sub2">${c.province} · ${c.city}</div></td>
      <td><span class="lv-badge lv-${c.overall}">${c.overall}</span></td>
      <td class="sub2">${hz}</td>
      <td class="sub2"><b style="color:var(--brand2);font-size:14px">${n}</b> 类　${(c.insuranceHints||[]).join("、")||"—"}</td>
      <td><button class="mini-btn" onclick="event.stopPropagation();openDetail('${c.id}')">详情</button></td>
    </tr>`;
  }).join("");
}

/* ---------------- 指数保险研判 ---------------- */
/* 推荐级别：星级越多级别越高（★★★ 优先 / ★★ 重点 / ★ 试点） */
const INS_META = {
  "连阴雨指数保险":  {hazard:"连阴雨 / 多雨偏湿",     rec:"★★★ 优先", advice:"高频信号，建议本期首批落地，并配套连阴雨灾害预警做风险减量。"},
  "大风指数保险":    {hazard:"大风 / 大风-秋旱",      rec:"★★★ 优先", advice:"覆盖广、基差相对可控，建议与主粮、经济林果叠加设计触发档位。"},
  "降水指数保险":    {hazard:"降水偏多 / 较强降水",   rec:"★★★ 优先", advice:"与连阴雨指数互补，按标的耐渍性分档设计触发阈值。"},
  "干旱指数保险":    {hazard:"秋旱 / 气象波动",       rec:"★★ 重点",  advice:"9-07 期显著抬升，建议针对耐旱性弱作物（如果树、经济林果）先行试点。"},
  "低温指数保险":    {hazard:"低温 / 初霜冻前兆",     rec:"★★ 重点",  advice:"与霜冻指数协同，重点覆盖北方及高海拔县区。"},
  "霜冻指数保险":    {hazard:"初霜冻 / 低温",         rec:"★★ 重点",  advice:"针对果蔬、烤烟等霜敏感作物设计，阈值须结合物候校准。"},
  "暴雨指数保险":    {hazard:"强降水 / 暴雨",         rec:"★ 试点",   advice:"局部高发，建议按地形与排水条件分县域试点。"},
  "高温指数保险":    {hazard:"高温热害",              rec:"★ 试点",   advice:"覆盖少但损失重，建议特色作物 niche 试点。"}
};
const REC_CLASS = {"★★★ 优先":"lv-ext","★★ 重点":"lv-high","★ 试点":"lv-mid"};
function fmtRec(rec){ if(!rec) return "—"; return rec.replace(/★/g,'<span class="star">★</span>'); }
function prevData(){
  const sorted = [...DATA.periods].sort((a,b)=>a.period.localeCompare(b.period));
  const i = sorted.findIndex(p => p.period === curPeriod);
  return i > 0 ? sorted[i-1] : null;
}
function significance(prev,cur){
  const delta = cur - prev;
  if(prev === 0 && cur > 0) return {delta, txt:"本期新增强信号"};
  if(delta >= 10)            return {delta, txt:"气象风险显著增强"};
  if(delta > 0)              return {delta, txt:"气象风险上行"};
  if(delta < 0 && cur >= 50) return {delta, txt:"覆盖略回落但仍是高频信号"};
  if(delta < 0)              return {delta, txt:"覆盖回落"};
  return {delta, txt:"信号持续高位"};
}
function renderEval(){
  const counties = curData().counties;
  const curCnt = {};
  counties.forEach(c => (c.insuranceHints||[]).forEach(i => curCnt[i]=(curCnt[i]||0)+1));

  const prev = prevData();
  const prevCnt = {};
  if(prev){ prev.counties.forEach(c => (c.insuranceHints||[]).forEach(i => prevCnt[i]=(prevCnt[i]||0)+1)); }

  // 极高/高覆盖数 + 省份覆盖分布（每 ins type）
  const hiCnt = {}, provCnt = {};
  counties.forEach(c => {
    (c.insuranceHints||[]).forEach(i => {
      if(c.overall==="极高" || c.overall==="高") hiCnt[i]=(hiCnt[i]||0)+1;
      provCnt[i] = provCnt[i] || {};
      provCnt[i][c.province]=(provCnt[i][c.province]||0)+1;
    });
  });

  const entries = Object.entries(curCnt).sort((a,b)=>b[1]-a[1]);
  const total = counties.length;
  const top = entries[0] || ["—",0];

  // 顶部统计条
  document.getElementById("evalStats").innerHTML =
    `<div class="st">覆盖县域 <b>${total}</b> 个</div>` +
    `<div class="st">可匹配指数产品 <b>${entries.length}</b> 类</div>` +
    `<div class="st">需求最高 <b>${top[0].replace("指数保险","")}</b> 覆盖 <b>${top[1]}</b> 县</div>` +
    (prev ? `<div class="st">对比上期 <b>${prev.period}</b></div>` : "");

  // 需求分布 → 中国地图（散点颜色＝可匹配指数保险类别数）
  if(window.echarts && CHINA){
    try{ echarts.registerMap("china", CHINA); }catch(e){}
    const el = document.getElementById("evalMap");
    const chart = charts.evalMap || (charts.evalMap = echarts.init(el, null, {renderer:"canvas"}));
    const sc = counties.filter(c=>c.coord).map(c=>{
      const n = (c.insuranceHints||[]).length;
      return {name:c.county, id:c.id, value:[c.coord[0], c.coord[1], n],
        itemStyle:{color: INS_COLOR[Math.min(n,3)]}};
    });
    chart.setOption({
      backgroundColor:"transparent",
      tooltip:{trigger:"item", formatter:p=>{
        if(p.data && p.data.id){
          const c = curData().counties.find(x=>x.id===p.data.id);
          if(!c) return "";
          const n = (c.insuranceHints||[]).length;
          return `<b>${c.county}</b><br/>${c.province}·${c.city}<br/>整体风险：<b style="color:${LEVEL_COLOR[c.overall]}">${c.overall}</b><br/>可匹配指数保险：<b style="color:${INS_COLOR[Math.min(n,3)]}">${(c.insuranceHints||[]).join("、")||"—"}</b><br/><span style="color:#9fb3d6">点击查看详情</span>`;
        }
        return p.name;
      }},
      geo:{ map:"china", roam:true, zoom:1.15,
        itemStyle:{areaColor:"#132b52", borderColor:"#41639c"},
        emphasis:{itemStyle:{areaColor:"#1b3a6d"}, label:{show:false}},
        label:{show:false}},
      series:[{type:"scatter", coordinateSystem:"geo", data:sc,
        symbolSize:v=>{ const k = Math.min(v[2]||0,3); return [10,16,22,28][k]||12; },
        emphasis:{scale:1.4},
        itemStyle:{borderColor:"#fff", borderWidth:.5, opacity:.92}}]
    }, true);
    chart.off("click");
    chart.on("click", p => { if(p.data && p.data.id) openDetail(p.data.id); });
    setTimeout(()=>{ try{chart.resize();}catch(e){} }, 60);
  }

  // 推荐优先级矩阵（7 列：星级/省份/推荐原因）
  document.getElementById("evalMatrixBody").innerHTML = entries.map(([k,v])=>{
    const m = INS_META[k] || {hazard:"—", rec:"—", advice:"结合本县域灾害结构专项设计。"};
    const pv = prevCnt[k]||0;
    const sig = significance(pv, v);
    const hi  = hiCnt[k]||0;
    const pct = ((v/total)*100).toFixed(1);
    const provs = Object.entries(provCnt[k]||{}).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
    const provText = provs.length===0 ? "—" :
      (provs.length<=5 ? provs.join("、") : (provs.slice(0,5).join("、") + ` 等 ${provs.length} 省`));
    const deltaStr = sig.delta>0 ? `较上期 <b style="color:#52c41a">+${sig.delta}</b> 县`
                  : sig.delta<0 ? `较上期 <b style="color:#ff7a45">${sig.delta}</b> 县`
                  : "与上期持平";
    const reason =
      `覆盖 <b>${v}</b> 县（占 <b>${pct}%</b>），其中极高/高风险 <b>${hi}</b> 县；` +
      `${deltaStr}，<b>${sig.txt}</b>，值得优先配置。`;
    return `<tr>
      <td><div class="nm">${k}</div></td>
      <td><b style="color:var(--brand2)">${v}</b> 县</td>
      <td class="sub2">${provText}</td>
      <td class="sub2">${m.hazard}</td>
      <td><span class="lv-badge lv-${REC_CLASS[m.rec]||"lv-low"}">${fmtRec(m.rec)}</span></td>
      <td class="sub2">${reason}</td>
      <td class="sub2">${m.advice}</td>
    </tr>`;
  }).join("");
}

/* ---------------- 风险-农业-保险耦合 ---------------- */
/* 作物×灾害 影响与损失知识库（收获期/生长季定性研判，损失为典型幅度区间，具体以灾情核定为准） */
const CROP_KB = {
  "小麦":{hz:["连阴雨","干旱","大风"],imp:{"连阴雨":"灌浆/收获期遇连阴雨易籽粒霉变、穗发芽，品质降级，典型减产 10%–20%；田间机械收割受阻，收获期拉长。","干旱":"拔节-灌浆期干旱致穗小粒瘪、千粒重下降，典型减产 10%–20%。","大风":"成熟期大风易倒伏，机械收获损失加大，典型减产 5%–15%。"},"adv":"关注收获窗口天气滚动预报，抢晴收获；渍涝田提前清沟；倒伏田人工辅助收获减少落粒。"},
  "水稻":{hz:["连阴雨","大风","低温"],imp:{"连阴雨":"成熟-收获期连阴雨致倒伏、穗上发芽（穗萌），米质下降，典型减产 10%–20%。","大风":"灌浆后期大风倒伏、落粒，典型减产 10%–25%；台风外围风害尤重。","低温":"灌浆期障碍型冷害致空秕粒增多，典型减产 10%–15%。"},"adv":"乳熟后期保持干湿交替促灌浆；大风前深水护苗；抢晴收脱，防穗芽。"},
  "玉米":{hz:["连阴雨","大风","干旱","初霜冻"],imp:{"连阴雨":"成熟收获期连阴雨致果穗霉变、籽粒萌动，典型减产 10%–25%；晾晒困难品质降级。","大风":"大喇叭口后大风倒伏/茎折，灌浆中断，典型减产 15%–30%。","干旱":"抽雄-灌浆期干旱致秃尖缺粒，典型减产 10%–20%。","初霜冻":"未成熟遇初霜冻植株冻死、灌浆终止，含水率高致减产 15%–30%。"},"adv":"倒伏田及时扶正培土或机械收穗；霜冻前抢收青贮转化；收后及时烘干防霉变。"},
  "大豆":{hz:["连阴雨","干旱"],imp:{"连阴雨":"鼓粒-收获期连阴雨致炸荚、籽粒霉变褐斑，典型减产 10%–20%。","干旱":"鼓粒期干旱致粒重下降，典型减产 10%–15%。"},"adv":"成熟后及时收获防炸荚；收后防潮储存。"},
  "谷子":{hz:["连阴雨","干旱"],imp:{"连阴雨":"成熟期连阴雨致穗部霉变、鸟啄鼠害加重，典型减产 10%–15%。","干旱":"抽穗-灌浆期干旱致秕谷增多，典型减产 10%–20%。"},"adv":"谷穗下垂期防穗发芽，及时收割晾晒。"},
  "马铃薯":{hz:["连阴雨","早霜冻"],imp:{"连阴雨":"收获期连阴雨致块茎田间腐烂、表皮破损带泥，商品率下降，减产 10%–20%。","早霜冻":"茎叶早霜冻枯迫使提前收获，块茎膨大不足，减产 10%–15%。"},"adv":"霜前抢收入库；储窖通风控湿防腐。"},
  "花生":{hz:["连阴雨","干旱"],imp:{"连阴雨":"收获期连阴雨致荚果发芽、黄曲霉污染风险上升，减产 10%–20% 且品质降级。","干旱":"饱果期干旱致果仁不饱满，减产 10%–15%。"},"adv":"看荚果成熟度适时收获；收后迅速晾晒防水霉。"},
  "油菜":{hz:["连阴雨","干旱"],imp:{"连阴雨":"秋播育苗期连阴雨致烂种烂苗、移栽推迟。","干旱":"播栽期秋旱致出苗不齐、苗弱。"},"adv":"抢墒/造墒播种，雨后及时排渍补苗。"},
  "棉花":{hz:["连阴雨","大风"],imp:{"连阴雨":"吐絮期连阴雨致烂铃、僵瓣花增多，品质与售价双降，减产 10%–20%。","大风":"大风致棉株倒伏落蕾，减产 5%–15%。"},"adv":"及时采收吐絮桃，雨前抢收；推株并垄改善通风。"},
  "苹果/猕猴桃":{hz:["大风","连阴雨","初霜冻"],imp:{"大风":"采前大风落果、碰擦伤，商品果率下降，减产 10%–20%。","连阴雨":"着色期连阴雨致糖度着色差、裂果，减产 5%–15%。","初霜冻":"采前初霜冻致果面冻伤、贮藏性变差。"},"adv":"加固架网防风；分期采收；雨后及时排水防裂。"},
  "甘蔗":{hz:["大风","干旱"],imp:{"大风":"台风级大风致蔗茎倒伏折断、糖分积累受阻，减产 15%–30%。","干旱":"伸长期干旱致茎径变细、节间短，减产 10%–20%。"},"adv":"大风前捆蔗防倒；倒伏蔗及时扶起培土。"},
  "烤烟":{hz:["连阴雨","大风"],imp:{"连阴雨":"成熟采烤期连阴雨致烟叶返青、烤后色泽差，均价下降 10%–20%。","大风":"大田后期大风折断烟株，减产 10%–15%。"},"adv":"成熟即采、密集烘烤；风前加固烟棚。"},
  "荔枝/龙眼":{hz:["大风"],imp:{"大风":"采前大风落果、断枝，减产 15%–30%。"},"adv":"采前疏果稳果、加固枝条；风后及时采销落果伤果。"},
  "香蕉":{hz:["大风"],imp:{"大风":"大风致假茎折断、果穗擦伤，全株损毁风险高，减产 20%–40%。"},"adv":"立桩绑束防风；风前提前采收大蕉串。"},
  "茶叶":{hz:["干旱","大风"],imp:{"干旱":"秋旱致秋茶减产、叶片老化，减产 10%–15%。","大风":"风害致嫩梢机械损伤。"},"adv":"茶园铺草保墒；秋茶及时封园养树。"},
  "红枣":{hz:["连阴雨","大风"],imp:{"连阴雨":"成熟期连阴雨致裂果、浆烂，减产 10%–25%。","大风":"落果加重。"},"adv":"雨前抢收或铺反光膜促干；采后及时烘干。"}
};
function coupleKpi(key){
  const box=document.getElementById("coupleKpiDetail");
  const cs=curData().counties;
  const hi=cs.filter(c=>c.overall==="极高"||c.overall==="高")
    .sort((a,b)=>(LEVEL_IDX[b.overall]||0)-(LEVEL_IDX[a.overall]||0));
  const provCnt=k=>{const m={};cs.forEach(c=>{m[c.province]=(m[c.province]||0)+1;});return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
  let html="";
  if(key==="ext"){
    html=`<div class="ckd-h">🔴 极高风险县（${hi.filter(c=>c.overall==="极高").length} 个）——建议立即启动风险减量巡查</div>`+
      hi.filter(c=>c.overall==="极高").map(c=>rowCounty(c)).join("");
  } else if(key==="high"){
    const hs=hi.filter(c=>c.overall==="高");
    html=`<div class="ckd-h">🟠 高风险县（${hs.length} 个）——按省分布</div><div class="ckd-chips">`+
      provCnt("高").map(([p,n])=>`<span class="ins-chip">${p}：<b>${n}</b> 县</span>`).join("")+
      `</div><div class="ckd-h2">前 18 县：</div>`+hs.slice(0,18).map(c=>rowCounty(c)).join("");
  } else if(key==="crops"){
    const cnt={};cs.forEach(c=>{if(c.overall==="极高"||c.overall==="高")(c.crops||[]).forEach(x=>cnt[x]=(cnt[x]||0)+1);});
    html=`<div class="ckd-h">🌾 主栽作物风险暴露（高/极高风险县中种植次数，点击柱条看灾害影响画像）</div><div class="ckd-chips">`+
      Object.entries(cnt).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="ins-chip" style="cursor:pointer" onclick="showCropDetail('${k}')">${k}：<b>${v}</b></span>`).join("")+`</div>`;
  } else if(key==="ins"){
    const cnt={};cs.forEach(c=>(c.insuranceHints||[]).forEach(i=>cnt[i]=(cnt[i]||0)+1));
    html=`<div class="ckd-h">🛡 可匹配指数保险类别（覆盖县数）</div><div class="ckd-chips">`+
      Object.entries(cnt).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="ins-chip">${k}：<b>${v}</b> 县</span>`).join("")+
      `</div><div class="rank-note">映射基于四窗口灾害信号自动生成，投产前须经标的、阈值、基差与精算校准。</div>`;
  } else if(key==="total"){
    const m={};hi.forEach(c=>{m[c.province]=m[c.province]||{ext:0,hi:0};c.overall==="极高"?m[c.province].ext++:m[c.province].hi++;});
    html=`<div class="ckd-h">📍 高/极高风险县按省分布（合计 ${hi.length} 县）</div>`+
      Object.entries(m).sort((a,b)=>(b[1].ext*2+b[1].hi)-(a[1].ext*2+a[1].hi)).map(([p,v])=>
        `<div class="ckd-row"><span class="ckd-p">${p}</span><span>极高 <b style="color:var(--lv-ext)">${v.ext}</b> · 高 <b style="color:var(--lv-high)">${v.hi}</b> · 小计 <b>${v.ext+v.hi}</b></span></div>`).join("");
  }
  box.innerHTML=html;
  box.classList.remove("hidden");
  box.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function rowCounty(c){
  return `<div class="ckd-row" style="cursor:pointer" onclick="openDetail('${c.id}')"><span class="ckd-p"><span class="lv-dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${LEVEL_COLOR[c.overall]};margin-right:6px"></span>${c.county} <small style="color:var(--txt3)">${c.province}·${c.city}</small></span><span class="sub2">${c.windows[0]?c.windows[0].hazard:"—"}</span><span class="lv-badge lv-${c.overall}">${c.overall}</span></div>`;
}
function showCropDetail(crop){
  const kb=CROP_KB[crop];
  const box=document.getElementById("cropDetail");
  const cs=curData().counties;
  let hiN=0;const hzCnt={};
  cs.forEach(c=>{if((c.crops||[]).includes(crop)&&(c.overall==="极高"||c.overall==="高")){hiN++;(c.windows||[]).forEach(w=>w.hazard.split(/[、/]/).forEach(x=>{x=x.trim();if(x)hzCnt[x]=(hzCnt[x]||0)+1;}));}});
  const topHz=Object.entries(hzCnt).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>`${k}（${v} 县次）`).join("、");
  const imp=kb?Object.entries(kb.imp).map(([k,v])=>`<div class="ckd-imp"><span class="ckd-k">${k}</span><span class="ckd-v">${v}</span></div>`).join(""):"<div class='sub2'>该作物暂无结构化风险画像，可参考同大类作物。</div>";
  box.innerHTML=`<div class="ckd-h">🌾 ${crop} · 灾害影响与损失画像</div>
    <div class="ckd-meta">高/极高风险县暴露 <b style="color:var(--brand2)">${hiN}</b> 县次 ｜ 高发灾害信号：${topHz||"—"}</div>
    ${imp}
    ${kb?`<div class="ckd-adv">💡 农事建议：${kb.adv}</div>`:""}
    <div class="rank-note">影响与损失幅度为行业经验的定性研判区间（因品种、生育期、田管水平而异），供风险减量与保险匹配参考，不构成定损依据。</div>`;
  box.classList.remove("hidden");
  box.scrollIntoView({behavior:"smooth",block:"nearest"});
}

/* ---------------- 风险-农业-保险耦合 ---------------- */
function renderCouple(){
  const counties = curData().counties;
  const allCrops = new Set();
  const allIns   = new Set();
  counties.forEach(c => {
    (c.crops||[]).forEach(x=>allCrops.add(x));
    (c.insuranceHints||[]).forEach(x=>allIns.add(x));
  });
  const kpis = [
    {key:"ext",   cls:"ext",  num: counties.filter(c=>c.overall==="极高").length, lbl:"极高风险县"},
    {key:"high",  cls:"high", num: counties.filter(c=>c.overall==="高").length,   lbl:"高风险县"},
    {key:"crops", cls:"tot",  num: allCrops.size,                                  lbl:"主栽作物种类"},
    {key:"ins",   cls:"high", num: allIns.size,                                    lbl:"可匹配指数保险类别"},
    {key:"total", cls:"mid",  num: counties.filter(c=>c.overall==="极高"||c.overall==="高").length, lbl:"高/极高风险县（合计）"}
  ];
  document.getElementById("coupleKpis").innerHTML = kpis.map(k=>`
    <div class="kpi ${k.cls}" style="cursor:pointer" title="点击展开详情" onclick="coupleKpi('${k.key}')"><div class="bar"></div><div class="num">${k.num}</div><div class="lbl">${k.lbl} ▾</div></div>`).join("");

  // 作物风险暴露
  const cropHi = {};
  counties.forEach(c=>{
    if(c.overall==="极高" || c.overall==="高"){
      (c.crops||[]).forEach(x => cropHi[x]=(cropHi[x]||0)+1);
    }
  });
  const cropArr = Object.entries(cropHi).sort((a,b)=>b[1]-a[1]).slice(0,12);

  // 保险×风险构成
  const insLevel = {};
  counties.forEach(c=>{
    (c.insuranceHints||[]).forEach(i=>{
      insLevel[i] = insLevel[i] || {极高:0,高:0,中:0,低:0};
      insLevel[i][c.overall]=(insLevel[i][c.overall]||0)+1;
    });
  });
  const insArr = Object.entries(insLevel).sort((a,b)=>(b[1].极高+b[1].高)-(a[1].极高+a[1].高));

  if(window.echarts){
    const c1 = charts.coupleCrop || (charts.coupleCrop = echarts.init(document.getElementById("coupleCropChart"), null, {renderer:"canvas"}));
    c1.setOption({
      grid:{left:90,right:24,top:14,bottom:24,containLabel:true},
      tooltip:{trigger:"axis", axisPointer:{type:"shadow"}, formatter:p=>`${p[0].name}<br/>高/极高风险县种植：<b>${p[0].value}</b> 县次`},
      xAxis:{type:"value", axisLabel:{color:"#9fb2d4"}, splitLine:{lineStyle:{color:"#1c2c4a"}}},
      yAxis:{type:"category", data:cropArr.map(e=>e[0]).reverse(), axisLabel:{color:"#e8eefc", fontSize:12}},
      series:[{type:"bar", data:cropArr.map(e=>e[1]).reverse(), barWidth:"55%",
        itemStyle:{color:new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:"#f4a261"},{offset:1,color:"#e63946"}]), borderRadius:[0,6,6,0]},
        label:{show:true, position:"right", color:"#e8eefc", formatter:"{c}"}}]
    }, true);
    c1.off("click");
    c1.on("click", p=>{ if(p.name) showCropDetail(p.name); });
    setTimeout(()=>{ try{c1.resize();}catch(e){} }, 60);

    const c2 = charts.coupleIns || (charts.coupleIns = echarts.init(document.getElementById("coupleInsChart"), null, {renderer:"canvas"}));
    c2.setOption({
      grid:{left:90,right:24,top:36,bottom:24,containLabel:true},
      tooltip:{trigger:"axis", axisPointer:{type:"shadow"}},
      legend:{data:["极高","高","中","低"], textStyle:{color:"#9fb2d4"}, top:0, right:0},
      xAxis:{type:"value", axisLabel:{color:"#9fb2d4"}, splitLine:{lineStyle:{color:"#1c2c4a"}}},
      yAxis:{type:"category", data:insArr.map(e=>e[0]).reverse(), axisLabel:{color:"#e8eefc", fontSize:12}},
      series:["极高","高","中","低"].map(lv=>({
        name:lv, type:"bar", stack:"all",
        data:insArr.map(e=>e[1][lv]||0).reverse(),
        itemStyle:{color: LEVEL_COLOR[lv]},
        label:{show:false}
      }))
    }, true);
    setTimeout(()=>{ try{c2.resize();}catch(e){} }, 60);
  }

  // 耦合清单
  const hi = counties
    .filter(c=>c.overall==="极高" || c.overall==="高")
    .sort((a,b)=> (LEVEL_IDX[b.overall]||0)-(LEVEL_IDX[a.overall]||0) || a.province.localeCompare(b.province));
  document.getElementById("coupleEmpty").classList.toggle("hidden", hi.length>0);
  document.getElementById("coupleBody").innerHTML = hi.map(c=>{
    const hz = c.windows[0]? c.windows[0].hazard : "—";
    const hints = c.insuranceHints||[];
    const gap = hints.length===0 ? {txt:"无匹配保险", cls:"lv-ext"}
              : hints.length<=1  ? {txt:"匹配偏弱",  cls:"lv-high"}
              :                    {txt:"已匹配",    cls:"lv-low"};
    return `<tr onclick="openDetail('${c.id}')" style="cursor:pointer">
      <td><div class="nm">${c.county}</div><div class="sub2">${c.province} · ${c.city}</div></td>
      <td><span class="lv-badge lv-${c.overall}">${c.overall}</span></td>
      <td class="sub2">${(c.crops||[]).join("、")||"—"}</td>
      <td class="sub2">${hz}</td>
      <td class="sub2">${hints.join("、")||"—"}</td>
      <td><span class="lv-badge ${gap.cls}">${gap.txt}</span></td>
      <td><button class="mini-btn" onclick="event.stopPropagation();openDetail('${c.id}')">详情</button></td>
    </tr>`;
  }).join("");
}

/* ---------------- 高风险县域排行榜（对标参照站排行榜弹窗） ---------------- */
function openRank(){
  const cs = [...curData().counties].sort((a,b)=>
    (LEVEL_IDX[b.overall]||0)-(LEVEL_IDX[a.overall]||0) || b.coord[1]-a.coord[1]);
  const d = curData();
  document.getElementById("rankSub").textContent =
    `${d.periodLabel} · 覆盖 ${d.total} 县 · 极高 ${d.summary["极高"]||0} / 高 ${d.summary["高"]||0}`;
  const seg = (title, lv, list, color)=> list.length===0 ? "" :
    `<div class="rsec" style="color:${color}">${title}（${list.length} 县）</div>` +
    list.map((c,i)=>`<div class="rr" onclick="closeRank();openDetail('${c.id}')">
      <span class="rk">${i+1}</span>
      <span class="nm">${c.county}</span>
      <span class="hz2">${c.province}·${c.city} · ${c.windows[0]?c.windows[0].hazard:"—"}</span>
      <span class="lv-badge lv-${c.overall}">${c.overall}</span>
    </div>`).join("");
  const ext = cs.filter(c=>c.overall==="极高").slice(0,20);
  const hig = cs.filter(c=>c.overall==="高").slice(0,30);
  const mid = cs.filter(c=>c.overall==="中").slice(0,20);
  document.getElementById("rankBody").innerHTML =
    seg("🔴 极高风险", "极高", ext, "#ff4d4f") +
    seg("🟠 高风险", "高", hig, "#ff7a45") +
    seg("🟡 中风险", "中", mid, "#ffc53d") +
    `<div class="rank-note">点击任一县查看完整风险预测详情；排序规则：等级 → 纬度（北优先）。</div>`;
  document.getElementById("rankModal").classList.remove("hidden");
}
function closeRank(){ document.getElementById("rankModal").classList.add("hidden"); }

/* ---------------- 详情抽屉 ---------------- */
function openDetail(id){
  const c = curData().counties.find(x=>x.id===id);
  if(!c) return;
  document.getElementById("dTitle").textContent = `${c.county}气象灾害风险预测`;
  document.getElementById("dSub").textContent = `${c.province} · ${c.city} · adcode ${c.adcode||"-"} · 整体风险【${c.overall}】`;
  document.getElementById("dImgs").innerHTML = (c.preview||c.files.png).map(p=>
    `<img src="${abs(p)}" loading="lazy" alt="风险图">`).join("");
  document.getElementById("dConclusion").textContent = stripMd(c.conclusion||"");
  document.getElementById("dWindows").innerHTML = `<table class="win-table"><tr><th>窗口</th><th>时段</th><th>主要灾害</th><th>等级</th></tr>` +
    c.windows.map(w=>`<tr><td>${w.name}</td><td>${w.period}</td><td>${w.hazard}</td><td><span class="lv-badge lv-${w.level}">${w.level}</span></td></tr>`).join("") + `</table>`;
  document.getElementById("dEnso").textContent = stripMd(c.enso||"");
  document.getElementById("dIns").innerHTML = (c.insuranceHints||[]).map(i=>`<span class="ins-chip" style="margin:0 8px 8px 0;display:inline-block">${i}</span>`).join("") || "—";
  const f = c.files;
  document.getElementById("dFiles").innerHTML =
    `<a class="file-link" href="${abs(f.docx)}" target="_blank">📄 报告 Word</a>` +
    `<a class="file-link" href="${abs(f.md)}" target="_blank">📝 Markdown</a>` +
    f.png.map((p,i)=>`<a class="file-link" href="${abs(p)}" target="_blank">🖼 图${i+1}</a>`).join("") +
    `<button class="mini-btn" onclick="packOne('${c.id}')">⬇ 打包下载本县附件</button>`;
  document.getElementById("detail").classList.remove("hidden");
}
function closeDetail(){ document.getElementById("detail").classList.add("hidden"); }
function stripMd(s){ return (s||"").replace(/^\s*>\s?/gm,"").replace(/\*\*/g,"").replace(/\|/g," ").replace(/\n{2,}/g,"\n").trim(); }

/* ---------------- 下载 ---------------- */
function dl(url){ const a=document.createElement("a"); a.href=abs(url); a.download=""; document.body.appendChild(a); a.click(); a.remove(); }

async function packOne(id){
  const c = curData().counties.find(x=>x.id===id);
  if(!c) return;
  if(typeof JSZip==="undefined"){
    [c.files.docx,c.files.md,...c.files.png].forEach(dl); return;
  }
  // 跨域附件（GitHub Pages 模式）受 CORS 限制，无法 fetch 打包 → 逐个下载
  if(ASSETS_BASE !== "./" || typeof JSZip==="undefined"){
    [c.files.docx,c.files.md,...c.files.png].forEach((f,i)=>setTimeout(()=>dl(f), i*600));
    alert("附件较多，已为您逐个触发下载（浏览器可能提示允许多次下载，请点击允许）。");
    return;
  }
  const zip = new JSZip();
  const files = [c.files.docx,c.files.md,...c.files.png];
  let ok=0;
  for(const f of files){
    try{ const r=await fetch("./"+f); const b=await r.blob(); zip.file(f.split("/").pop(), b); ok++; }
    catch(e){}
  }
  if(ok===0){ alert("附件读取失败"); return; }
  const blob = await zip.generateAsync({type:"blob"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`${c.county}_气象风险预警附件.zip`; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
}

async function downloadAll(){
  const cs = curData().counties;
  if(!confirm(`将依次下载当前期次（${curData().periodLabel}）全部 ${cs.length} 个县域的 Word 报告（${cs.length} 个文件），浏览器可能提示“允许多次下载”，请点击允许。是否继续？`)) return;
  let i=0;
  for(const c of cs){
    dl(c.files.docx); i++;
    if(i%8===0) await new Promise(r=>setTimeout(r,400));
  }
  alert(`已触发 ${i} 个报告下载。`);
}

/* ---------------- 启动 ---------------- */
(function(){
  try{
    if(sessionStorage.getItem("nongxian_auth")==="1"){ AUTHED=true; enterApp(); return; }
  }catch(e){}
  // 迟到补救：用户已通过内联登录进入（登录页已隐藏）但本脚本刚加载完成
  try{
    var loginEl=document.getElementById("login");
    if(loginEl && loginEl.classList.contains("hidden") && !DATA){ enterApp(); }
  }catch(e){}
})();
