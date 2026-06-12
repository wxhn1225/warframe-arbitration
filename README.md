# warframe-arbitration

Warframe 仲裁一站式工具，纯静态网页，部署在 GitHub Pages：

**<https://wxhn1225.github.io/warframe-arbitration/>**

| 页面 | 功能 |
|------|------|
| [仲裁队列](https://wxhn1225.github.io/warframe-arbitration/)（`/`） | 整点轮换时间表：查看当前/未来仲裁节点，按等级筛选、搜索、自定义 Tier 评级 |
| [日志分析](https://wxhn1225.github.io/warframe-arbitration/log/)（`/log`） | 上传 `EE.log` 在浏览器本地解析仲裁记录：无人机统计、期望生息精华、敌人饱和度、事件时间线 |

---

## 仲裁队列（`/`）

- **轮换时间表**：每小时一个节点，展示节点名 / 星球 / 任务类型 / 派系 / 敌人等级（中文）
- **范围切换**：24 小时 / 7 天 / 30 天 / 3 个月 / 1 年
- **等级筛选与搜索**：按 Tier（S / A+ / A / A- / B / C / 未评级）过滤，支持节点关键字搜索
- **自定义等级表**：每个节点的 Tier 可自行调整，保存在 `localStorage`；可恢复默认
- **导出**：当前选择范围的仲裁序列可导出 TXT / JSON

### 数据来源

- `arbys.txt`：仲裁轮换序列源数据（`时间戳,NodeId` 每小时一条）
- `scripts/compact-schedule.mjs`：把 `generated/arbys.schedule.json` 压缩为 v2 紧凑格式
  （起始时间 + 节点字典 + 索引序列，整点等距无需逐条存时间戳），输出到 `web/public/data/`
- 节点中文信息来自 `warframe-public-export-plus` 子模块

---

## 日志分析（`/log`）

在浏览器本地解析主机的 `EE.log`，**日志不会上传到任何服务器**。

### 使用方式

1. 打开页面，拖拽或点击上传 `EE.log`（Windows 路径：`%LOCALAPPDATA%\Warframe`）
2. 默认展示最近 2 次有效仲裁（时长 < 1 分钟自动排除），次数可调

### 界面功能

| 功能 | 说明 |
|------|------|
| 主题切换 | 深海蓝 / 暖雾暗 / 暖奶油 三套配色，持久化到 `localStorage` |
| 截图导出 | 一键将单次分析卡片保存为 PNG |
| 查看详情 | 事件时间线曲线图 + 完整事件列表，支持倍速播放、进度拖拽、波次跳转 |
| 时间口径 | 主机时间 / 最后客机时间 / 手动输入 |
| 增益开关 | 4 个资源掉落倍率独立开关，实时重算期望 |

### 展示指标

| 指标 | 说明 |
|------|------|
| 节点信息 | 节点名 / 星球 / 任务类型 / 派系（由 NodeId 从 ExportRegions 解析） |
| 无人机生成 | `CorpusEliteShieldDroneAgent` 生成次数 |
| 敌人生成 | 区间内最后一条 `OnAgentCreated` 的 `Spawned N` |
| 波次 / 轮次 | 防御按 `WaveDefend`、镜像防御按 `LoopDefend`、拦截按轮次播报、生存按 5 分钟 tier 标记 |
| 期望生息 | 无人机掉落期望（6% × 倍率）+ 轮次奖励期望，并折算 1h 期望 |
| 评级 | 按满状态 1h 期望生息：S ≥ 800、A+ ≥ 700、A ≥ 600、A- ≥ 500、其余 F |
| 敌人饱和度 | `MonitoredTicking` 按档分桶的时间占比（总时间 / 有效时间两种口径） |

### 解析机制（核心标记）

- **任务定位**：`ThemedSquadOverlay.lua` 的 `Mission name` / `Cached mission name=` / `ShowMissionVote` 三种开始标记；
  `Background.lua: EliteAlertMission at <NodeId>` 结束标记（取最后一次）
- **统计区间**：`SS_STARTED` → `SS_ENDING`（`GameRulesImpl` 状态机），区间外的生成不计入
- **总时间**：`EndOfMatch.lua: Initialize` / `ExtractionTimer.lua: EOM` 最后一次出现时间 − `SS_STARTED`
- **任务类型**：NodeId + `ExportRegions.json` 识别（防御 / 拦截 / 镜像防御 / 生存）

### 大文件性能

- 解析在 Web Worker 中进行，主线程不卡顿
- **> 16MB 的日志走并行路径**：最多 6 个 Worker 按字节段并行扫描标记行
  （单遍正则交替，约 99.9% 的无关行只被扫过不被处理），再按序回放状态机，
  结果与逐行解析完全一致
- 实测 8GB 日志约 9 秒解析完成（NVMe），内存占用几十 MB，10GB+ 日志同样可用

---

## 项目结构

```
warframe-arbitration/
├─ arbys.txt                      # 仲裁轮换序列源数据
├─ generated/                     # 中间产物（排期/节点/警告 JSON）
├─ scripts/
│  ├─ compact-schedule.mjs        # 排期压缩为 v2 紧凑格式
│  └─ prepare-warframe-data.mjs   # 构建期裁剪节点/翻译数据（339KB+3.5MB → 87KB+22KB）
├─ warframe-public-export-plus/   # Git 子模块：游戏导出数据
└─ web/                           # Next.js 应用
   ├─ src/app/                    # 仲裁队列页（/）
   ├─ src/app/log/                # 日志分析页（/log），样式作用域在 .arb-log 下
   └─ src/lib/eelog/              # EE.log 解析内核（parser + 扫描/解析 Worker）
```

---

## 本地开发

```bash
git clone --recurse-submodules https://github.com/wxhn1225/warframe-arbitration.git
cd warframe-arbitration/web
npm install

npm run dev     # 开发服务器（http://localhost:3000）
npm run build   # 静态导出到 web/out/（自动先裁剪节点数据）
```

> 日志分析页在 dev 下首次使用前，若 `web/public/warframe-public-export-plus/` 不存在，
> 先执行 `node scripts/prepare-warframe-data.mjs` 生成。

## 部署

push 到 `main` 后由 GitHub Actions 自动构建并部署到 GitHub Pages（`.github/workflows/pages.yml`，
checkout 时拉取子模块）。

## 技术栈

| 项目 | 说明 |
|------|------|
| Next.js 16（App Router，静态导出） | `output: export`，纯静态 HTML/JS |
| React 19 + TypeScript | UI 与类型安全 |
| Tailwind CSS 4 | 仲裁队列页样式 |
| @tanstack/react-virtual | 长列表虚拟滚动 |
| html-to-image | 日志分析页截图导出 |
| Web Worker | EE.log 解析与大文件并行扫描 |
| warframe-public-export-plus | Git 子模块，节点/派系/任务类型数据 |
| GitHub Actions + GitHub Pages | CI/CD |
