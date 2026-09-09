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
function doLogin(e){
  e.preventDefault();
  const v = document.getElementById("pw").value;
  const err = document.getElementById("loginErr");
  if(v === PW){
    sessionStorage.setItem("nongxian_auth","1");
    enterApp();
  } else {
    err.textContent = "口令错误，请重新输入";
  }
  return false;
}
function logout(){
  sessionStorage.removeItem("nongxian_auth");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
}
function enterApp(){
  document.getElementById("login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  if(!DATA){ loadData(); }
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
    alert("数据加载失败：" + err.message);
  }
}

/* ---------------- UI 初始化 ---------------- */
function bootUI(){
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

async function renderMap(){
  if(!window.echarts || !CHINA) return;
  try{ echarts.registerMap("china", CHINA); }catch(e){}
  const el = document.getElementById("chinaMap");
  const chart = charts.map || (charts.map = echarts.init(el, null, {renderer:"canvas"}));
  let mapName, scope;
  if(mapLevel==="china"){
    mapName="china"; scope={lvl:"china"};
  } else if(mapLevel==="prov"){
    const g = await fetchGeo("prov", curProv.adcode);
    mapName=`prov-${curProv.adcode}`; echarts.registerMap(mapName, g);
    scope={lvl:"prov", provAd:curProv.adcode};
  } else {
    const g = await fetchGeo("city", curCity.adcode);
    mapName=`city-${curCity.adcode}`; echarts.registerMap(mapName, g);
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
      itemStyle:{areaColor:"#0e1c38", borderColor:"#27395f"},
      emphasis:{itemStyle:{areaColor:"#16294a"}, label:{show:false}},
      label:{show:false}, regions },
    series:[{type:"scatter", coordinateSystem:"geo", data:sc,
      symbolSize:v=>{ const k = mapMode==="ins" ? Math.min(v[2]||0,3) : (v[2]||0); return [10,16,22,28][k]||12; }, emphasis:{scale:1.4},
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
        itemStyle:{areaColor:"#0e1c38", borderColor:"#27395f"},
        emphasis:{itemStyle:{areaColor:"#16294a"}, label:{show:false}},
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
function renderCouple(){
  const counties = curData().counties;
  const allCrops = new Set();
  const allIns   = new Set();
  counties.forEach(c => {
    (c.crops||[]).forEach(x=>allCrops.add(x));
    (c.insuranceHints||[]).forEach(x=>allIns.add(x));
  });
  const kpis = [
    {cls:"ext",  num: counties.filter(c=>c.overall==="极高").length, lbl:"极高风险县"},
    {cls:"high", num: counties.filter(c=>c.overall==="高").length,   lbl:"高风险县"},
    {cls:"tot",  num: allCrops.size,                                  lbl:"主栽作物种类"},
    {cls:"high", num: allIns.size,                                    lbl:"可匹配指数保险类别"},
    {cls:"mid",  num: counties.filter(c=>c.overall==="极高"||c.overall==="高").length, lbl:"高/极高风险县（合计）"}
  ];
  document.getElementById("coupleKpis").innerHTML = kpis.map(k=>`
    <div class="kpi ${k.cls}"><div class="bar"></div><div class="num">${k.num}</div><div class="lbl">${k.lbl}</div></div>`).join("");

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
  if(sessionStorage.getItem("nongxian_auth")==="1"){ enterApp(); }
})();
