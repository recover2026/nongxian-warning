# 阳光农险 · 县级气象灾害风险预警超级平台 — 部署说明

本目录为纯前端静态站点，无需后端，可直接部署到任意静态托管服务。

## 目录结构
```
web/
├── index.html          # 入口（含登录门：口令 nongxian2026）
├── css/style.css       # 样式（深色风险大屏 + 登录页）
├── js/app.js           # 逻辑：大屏/清单/详情/指数保险匹配
├── data/
│   ├── reports.json    # 180 县结构化数据（支持多期次 periods）
│   └── china.json      # 中国省级 GeoJSON（地图底图）
├── static/logo.svg
└── reports/            # 报告附件，按期次分子目录：reports/{期次}/{省}/
    ├── 2026-09-01/     # 9-01 期 180 县（docx + md + 3 张预警图 jpg）
    └── 2026-09-07/     # 9-07 期 180 县
```

## 访问口令
平台登录口令：`nongxian2026`（与既有预警平台一致，含县域敏感信息，须最小化授权）。

## 部署方式
### 方式一：CloudStudio 一键部署（推荐，生成 *.workbuddy.link 网址）
在具备 `workbuddy_cloudstudio_deploy` 工具的环境中执行该技能，目录指向本 `web/` 即可。

### 方式二：任意静态服务器 / 对象存储 / Nginx
将 `web/` 整个目录上传，以 `index.html` 为入口即可。
- Nginx 示例：`root /path/to/web; index index.html;`
- 国内对象存储（OSS/COS）开启静态网站托管，默认首页 index.html。

### 方式三：本机预览（开发联调）
```
cd web && python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 依赖（浏览器端 CDN）
- ECharts 5.5.0（风险大屏图表/地图）
- JSZip 3.10.1（单县附件打包下载）
> 若部署环境无外网，请将上述库下载至本地 `js/vendor/` 并修改 index.html 引用。

## 数据更新（未来每期）
重跑 `build_web_data.py`（解析新一期 180 份 MD）+ `copy_reports.py`（拷贝附件），
reports.json 已为多期次结构预留，前端期次选择器可直接扩展。

## 天气指数保险匹配
`reports.json` 中每县含 `insuranceHints` 字段：依据四窗口主要灾害类型
（初霜冻/低温/暴雨/强降水/连阴雨/高温/大风/秋旱）自动映射可匹配的指数保险产品，
后续需结合标的、阈值、基差与精算校准后投产。
