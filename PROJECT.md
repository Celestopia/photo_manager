# PhotoManager 项目宏观架构与整体逻辑

## 1. 项目定位与核心目标

PhotoManager 是一个 **local-first** 的照片管理应用，围绕“本地文件可控、元信息可编辑、界面交互顺滑、数据可维护”设计。

核心目标：
- 以本地图库文件和 `photo_metadata.jsonl` 为数据事实来源。
- 提供画廊浏览 + 图像查看/编辑 + 批量编辑的完整工作流。
- 支持元信息回写（单图与批量），并保证写入过程尽量安全（原子替换）。
- 保持工程结构清晰，便于快速迭代与问题定位。

当前实现重点是图片（image），视频结构为后续扩展预留。

---

## 2. 技术栈与运行形态

### 2.1 技术栈
- 桌面容器：Electron（`electron`）
- 前端框架：Vue 3 SFC（`App.vue`）+ Vite 构建
- Node 侧能力：文件系统、IPC、脚本工具链
- 配置格式：YAML（`config.yml`）
- 元信息存储：JSONL（`photo_metadata.jsonl`）
- 缩略图缓存：WebP 文件缓存（`thumb_cache/<SHA256Hash>.webp`）
- EXIF 解析：`exifr`

### 2.2 两种运行模式
1. Electron 模式（主模式）
- 真实读取 `config.yml` 和 `photo_metadata.jsonl`
- 支持窗口控制、图片复制到系统剪贴板等桌面能力
- 所有元信息编辑可写回 JSONL

2. 浏览器预览模式（开发/调试辅助）
- `npm run start:web` 启动本地静态服务
- `public/browser-api.js` 提供 `photoManagerApi` 的 mock 实现
- UI 功能基本可演示，但写入仅在内存中，不落盘

---

## 3. 分层架构（从下到上）

### 3.1 数据与配置层
- `photo_workspace/`：图片实体
- `thumb_cache/`：画廊缩略图缓存目录（按 hash 命名）
- `photo_metadata.jsonl`：每行一个 JSON 元信息对象
- `config.yml`：路径、UI 参数、缩放范围等运行配置

特点：
- `FilePath` 是主要查询键
- `SHA256Hash` 用于完整性校验与“移动/改名”追踪

### 3.2 脚本工具层（离线维护）
目录：`scripts/`

- `common.js`
  - 配置读取、路径解析
  - 目录扫描、哈希计算、EXIF 读取
  - 元信息默认结构构造、JSONL 读写

- `init-metadata.js`
  - 全量扫描并重建元信息（当前 v1 聚焦图片）

- `update-metadata.js`
  - 增量更新
  - 保留已有 `Customization` 和 `Location`
  - 支持按 hash 识别文件移动/重命名

- `verify-metadata.js`
  - 重算 hash，检测缺失与篡改

- `export-metadata-csv.js`
  - JSONL 扁平化导出为 CSV
  - 列顺序优先放“用户最常编辑字段”（标题/评级/相册/标签/位置）

- `thumbnail-cache.js`
  - 缩略图生成核心（尺寸策略、超长图裁剪、并发生成）

- `build-thumbnails.js`
  - 按 metadata 生成/补齐缩略图缓存（`<SHA256Hash>.webp`）

- `start-web-preview.js`
  - 提供构建产物 + 本地 metadata/workspace 的浏览器预览服务

### 3.3 Electron 主进程层
目录：`src/main/`

- `main.js` 职责：
  - 启动时加载并合并配置（默认值 + `config.yml`）
  - 读取 JSONL，建立内存索引 `Map<FilePath, item>`
  - 后台预热缩略图缓存（缺失项增量生成）
  - 注册 IPC 接口（查询、更新、批量更新、复制、窗口动作）
  - 创建无边框窗口并维护窗口状态同步
  - 记录运行日志，辅助白屏/崩溃诊断

- `preload.js` 职责：
  - 在 `contextIsolation` 下建立安全桥接
  - 将 IPC 白名单能力暴露为 `window.photoManagerApi`
  - 对 payload 做可序列化处理，规避 structured clone 问题

### 3.4 渲染层（Vue UI）
目录：`src/renderer/`

- `App.vue`：主界面 SFC，承载画廊 + 图像查看核心逻辑
- `app.js`：渲染层入口，仅负责挂载 Vue 应用
- `styles.css`：布局、动画、面板与控件样式
- `index.html`：Electron 入口
- `browser.html` + `public/browser-api.js`：浏览器预览入口与 mock API
- `assets/*.svg`：图标资源

---

## 4. 核心数据模型与字段职责

每条记录（简化）包含：
- `FilePath`, `SHA256Hash`
- `FileSystem`（类型、扩展名、大小、拍摄/创建/修改时间）
- `Picture`（分辨率、dpi、位深）
- `GPS`
- `Location`（Country / Province / City / Site，用户维护）
- `Camera`
- `Customization`（Title / Rating / Album / Tags / Description / HiddenDescription / Hidden / MetadataUpdateDate）

实现约束：
- `Category` 已从逻辑中移除（与 Tags 重叠）
- Location 支持独立编辑与批量回写

---

## 5. 端到端运行流程

### 5.1 应用启动（Electron）
1. 主进程读取配置并构建运行参数。
2. 主进程加载 `photo_metadata.jsonl` 到内存索引。
3. 创建 BrowserWindow，加载 `index.html`。
4. 主进程后台启动缩略图缓存预热任务。
5. 渲染层 mounted 后请求配置与首屏画廊数据。

### 5.2 画廊查询流程
1. 渲染层根据当前状态构建查询对象（分页/筛选/排序/搜索）。
2. 调用 IPC `gallery:query`。
3. 主进程在内存中过滤、排序、分页，并按日期分组。
4. 返回 `groups/total/hasMore/filterOptions`，每条数据附带原图与缩略图路径。
5. 渲染层更新列表，画廊卡片优先加载缩略图，失败回退原图。

筛选/搜索规则（当前实现）：
- 隐藏项（`Customization.Hidden=true`）默认不展示
- 相册与标签为交集过滤
- 标题/文件名/描述按包含匹配

### 5.3 单图编辑流程（查看器右栏）
1. 用户在标题/评级/相册/位置/标签/描述等字段编辑。
2. 前端进入“待确认修改”状态（就地提示是/否）。
3. 确认后调用 `photo:update-customization`。
4. 主进程合并 patch、更新时间戳并原子写回 JSONL。
5. 返回更新项，前端同步 `selectedItem` 与画廊缓存。

### 5.4 批量编辑流程（画廊多选）
1. 用户进入选择模式，选择多张图（支持全选/全不选）。
2. 右侧批量编辑卡片填写：标题、待添加标签、位置（国家/省/市/具体地点）。
3. 调用 `photo:batch-update`。
4. 主进程逐项处理：
   - 标签采用“去重追加”
   - 单张冲突或缺失不会阻断整批
   - 统计 requested/updated/missing
5. 主进程一次性落盘，前端按返回 items 做局部刷新。

---

## 6. 交互逻辑总览

### 6.1 画廊模式
- 顶栏：还原、搜索、窗口控制
- 工具条：筛选（相册/标签）、排序、选择模式入口
- 卡片：标题、评级、基础分辨率信息
- 选择模式：多选、全选/全不选、批量编辑侧栏

### 6.2 图像查看模式
- 顶栏：返回画廊、拍摄日期、窗口控制
- 中区：图像展示（缩放/拖拽/旋转/镜像/复位/全屏）
- 左栏：图像信息与相机参数表
- 右栏：个性化信息可编辑字段
- 底栏：信息开关、图像操作工具、个性化侧栏开关

关键细节：
- 左右栏可隐藏，中心区按配置比例自适应
- 右键菜单支持复制图片/路径/JSON
- 工具按钮使用图标 + 延时 tooltip（动态避让）
- 输入控件聚焦时，左右方向键优先用于文本光标，不抢占为切图

---

## 7. IPC 边界（当前接口）

配置与查询：
- `app:get-config`
- `app:update-config`
- `gallery:query`

元信息写入：
- `photo:update-customization`
- `photo:batch-update`

复制能力：
- `photo:copy-path`
- `photo:copy-json`
- `photo:copy-image`

窗口能力：
- `window:action`
- `window:get-state`
- `window:state-changed`（事件）

边界原则：
- Renderer 不直接访问 Node 文件系统
- 所有持久化统一经主进程执行

---

## 8. 持久化与一致性策略

- 启动阶段：JSONL 全量读取到内存 Map，查询走内存以提升交互响应。
- 写入阶段：统一走 `saveMetadataMap` 原子替换（`*.tmp -> rename`）。
- 风险控制：解析失败行会跳过并记录日志，避免单行损坏阻塞启动。

这一策略在中小规模图库上实现简单、透明、可维护。

---

## 9. 关键设计取舍

1. JSONL + 内存索引，而非数据库
- 优点：格式直观、迁移成本低、故障可手工修复
- 代价：超大规模场景下查询与并发能力有限

2. Vite + SFC 前端组织
- 优点：模板/逻辑分离、组件化能力更强、构建与调试体验更稳定
- 代价：引入构建链，初次配置与依赖管理复杂度上升

3. 主进程集中写入
- 优点：权限边界清晰，利于安全与一致性
- 代价：需要维护明确 IPC 协议

---

## 10. 后续可演进方向

- 引入 TypeScript，提升大文件（尤其 `App.vue`）可维护性。
- 把渲染层按域拆分（gallery/viewer/batch-edit/state/utils）。
- 为批量编辑增加更细粒度结果回执（按 filePath 的成功/失败原因）。
- 当数据规模持续增大时引入索引缓存或 SQLite。
- 扩展视频元信息与视频查看/筛选能力。

---

## 11. 一句话总结

本项目采用“**脚本维护数据 + Electron 主进程承载系统能力 + Vue 渲染层实现复杂交互**”的分层架构，以本地 JSONL 为核心数据源，完成了从画廊浏览、单图编辑到批量元信息编辑的闭环，并保持了较好的可读性与可演进性。
