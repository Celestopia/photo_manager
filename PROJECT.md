# PhotoManager 项目设计说明

本文档是 PhotoManager 的实现级项目说明，面向维护者、代码审查者和后续 AI Agent。它记录当前代码已经采用的架构、数据契约、交互约束和故障处理策略。若代码与本文档不一致，应先确认差异是否为未完成迁移或实现缺陷，不应默默引入第二套规则。

## 1. 产品定位

PhotoManager 是一个 Windows 本地桌面媒体管理器，用于管理用户选择的独立图库。图库可以位于计算机上的任意普通目录，不要求位于项目目录内。

当前产品能力包括：

- 在同一时间线中管理图片和视频。
- 查看图片，播放视频，编辑共享的个性化信息。
- 按媒体类型、相册、标签、人物和层级地点筛选。
- 对图片和视频混合批量设置标题、相册、标签、人物和主地点。
- 以注册表管理标签、相册、人物和地点，禁止媒体元数据引用未注册值。
- 为每个图库独立保存元数据、注册表、缩略图、日志和备份。
- 在应用内执行初始化、增量更新、完整性检查、缩略图生成和 CSV 导出。

本项目坚持 local-first：核心浏览和管理流程不依赖网络服务，不把图库数据上传到远端，也不使用数据库。JSONL 是当前的数据事实来源。

## 2. 平台、技术栈与边界

- 目标平台：Windows 10/11 x64。
- 桌面容器：Electron 35。
- 渲染层：Vue 3 SFC + Vite。
- 图片解析和缩略图：Sharp、exifr。
- 视频探测和抽帧：项目内置 Windows x64 FFmpeg/FFprobe 8.1.2。
- 配置格式：YAML。
- 数据格式：JSONL；导出格式为 UTF-8 BOM CSV。
- 主进程与渲染器通过显式 IPC 白名单通信；渲染器不能直接访问 Node 文件系统。

当前支持的媒体扩展名：

- 图片：`.jpg`、`.jpeg`、`.png`、`.bmp`、`.webp`、`.gif`。
- 视频：`.mp4`、`.mov`、`.mkv`、`.avi`。

扩展名只决定是否纳入扫描。文件内容损坏或编码不兼容时，记录仍可存在，并通过 `Picture.ProbeStatus` 或 `Video.ProbeStatus` 表示技术解析状态。

## 3. 应用级配置与图库级数据

### 3.1 应用级配置

项目根目录的 `config.yml` 只保存所有图库共享的应用参数：

- `thumbnail`：缩略图尺寸、WebP 质量、极端长宽比阈值、图片并发数。
- `media`：FFmpeg 目录、探测超时、抽帧超时、视频缩略图并发数。
- `backup.retentionCount`：每个图库最多保留的备份快照目录数，最小为 1。
- `ui`：语言、画廊卡片宽度、查看器面板比例、默认可见性、缩放范围。

`config.yml` 不保存图库路径、数据目录、缩略图目录或日志目录。不同图库不能覆盖缩略图参数和 UI 参数。

### 3.2 应用私有状态

Electron `userData` 中只允许保存无法归属于某个图库的少量应用状态：

- `state.json`：最后一次成功打开的图库路径。
- 尚未打开图库时产生的启动诊断日志。

应用不维护最近图库列表。启动后会自动尝试打开上次成功使用的图库；失败时留在入口页并允许重试或重新选择。

### 3.3 图库目录

一个图库就是用户选择的媒体根目录。所有属于该图库的 PhotoManager 数据必须位于：

```text
<library-root>/.photo_manager/
```

标准结构：

```text
<library-root>/
  media files and user directories...
  .photo_manager/
    library.yml
    library.lock                  # 仅在图库被打开或脚本运行时存在
    initialization.json          # 仅初始化中或初始化失败后存在
    transaction.json             # 仅跨文件提交未完成时存在
    data/
      photo_metadata.jsonl
      tag_registry.jsonl
      album_registry.jsonl
      person_registry.jsonl
      location_registry.jsonl
      photo_metadata.csv          # 执行导出后可存在
    thumb_cache/
      cache_manifest.json
      <SHA256Hash>.webp
    backups/
      <timestamp>-<kind>-<suffix>/
        library.yml
        five JSONL files...
        manifest.json
    logs/
      YYYY-MM-DD.log
      initialization-failed.log   # 初始化失败时可存在
    temp/
      transactions/
      video thumbnail temporary files...
```

`.photo_manager` 不设置 Windows 隐藏属性。扫描器只排除图库根目录下这个保留目录；其它普通隐藏目录仍会被扫描。

## 4. 图库身份与 manifest

`library.yml` 是识别图库的必要文件，格式为：

```yaml
schemaVersion: 1
libraryId: 0fbd075b-f63e-41d0-91d9-39ea17487df7
name: My Library
createdAt: '2026-07-12T17:11:52.985Z'
updatedAt: '2026-07-12T17:13:02.959Z'
```

设计约束：

- `libraryId` 是创建图库时生成的 UUID，是图库的稳定身份。
- 图库移动到新路径后 UUID 不变，仍视为同一图库。
- `name` 是可编辑的显示名称，长度为 1 到 100 个字符。
- `schemaVersion` 不支持时拒绝打开，不做猜测式兼容。
- manifest 无法解析、UUID 非法或时间字段非法时，图库直接判定为损坏。
- 五个固定 JSONL 文件缺失时拒绝打开。

## 5. 图库边界规则

所有入口和 CLI 维护脚本必须遵守同一组边界规则：

1. 图库根目录必须存在、可写且不是 Windows 驱动器根目录。
2. 图库根目录不能是符号链接。
3. 扫描时不跟随文件或目录符号链接。
4. 不能在一个已存在图库的子目录中创建或打开另一个图库。
5. 一个图库内部不能包含另一个 `.photo_manager`。
6. 只管理图库根目录内的媒体；元数据中的 `FilePath` 必须是不能逃逸根目录的相对路径。
7. 路径键按字符串区分大小写。Windows 文件系统本身通常不允许仅大小写不同的两个实体，但应用层不主动折叠键。
8. 不实时监控文件系统。媒体发生增删改名后，用户需要执行“更新元数据”。

`scripts/library-core.js` 是路径解析、manifest、严格 JSONL 和原子文本写入的唯一共享实现；不要在其它模块中重新拼接图库内部目录规则。

## 6. 图库生命周期

### 6.1 应用启动

1. 获取 Electron 单实例锁；第二个进程不会创建第二个窗口，而会激活已有窗口。
2. 读取并规范化 `config.yml`。
3. 检查 `ffmpeg.exe` 和 `ffprobe.exe`。
4. 创建窗口并显示图库入口页。
5. 若媒体工具可用且保存了上次成功图库路径，自动尝试打开。
6. 只有图库锁、manifest、五个 JSONL 和全部内存索引加载成功后，才进入画廊，并更新“上次图库路径”。

FFmpeg 不可用时应用仍能显示入口页和错误原因，但禁止初始化或打开任何图库。

### 6.2 选择目录

选择目录后，主进程先检查：

- 若存在有效 `.photo_manager`，进入打开流程。
- 若存在失败初始化标记，展示失败原因；用户可确认清理失败数据后直接重新扫描并重试。
- 若不存在 `.photo_manager`，执行快速扫描，统计支持的媒体数量，再展示初始化确认。
- 若保留目录存在但不构成有效图库，不把它当作空目录重新初始化，而是报告损坏。

快速扫描可取消，不写入任何图库数据。

### 6.3 初始化

初始化前必须展示详细警告并要求用户显式确认。警告应说明：

- 将递归扫描支持的图片和视频。
- 将计算完整 SHA-256、读取 EXIF、运行 FFprobe。
- 将创建 `.photo_manager` 及数据、缓存、日志、备份和临时目录。
- 不会移动、改名、修改或删除原始媒体。
- 大图库耗时较长，期间不应断开磁盘或改变目录权限。
- 初始化可以取消，取消后删除本轮未完成数据。
- 图库不能与其它图库嵌套。

初始化流程：

1. 重新验证路径、父级/子级嵌套和 FFmpeg。
2. 创建 manifest、目录、初始化标记和独占锁。
3. 扫描媒体，逐个构造记录。
4. 无法读取或哈希的新媒体会跳过并进入最终警告报告；损坏但可读取的图片/视频会保留失败探测记录。
5. 记录重复 SHA-256，但不因此阻止初始化。
6. 原子写入元数据和四个空注册表。
7. 写入 committed 标记并做最低限度回读验证。
8. 删除初始化标记，释放初始化锁，再由主进程正常打开图库。

取消时删除整个 `.photo_manager`。非取消失败时保留 `library.yml`、`initialization.json` 和错误日志，删除其它未完成的数据、缓存与临时内容，以便诊断和显式重试。

### 6.4 打开与关闭

打开流程先验证图库，再获取独占锁。只有锁的持有者可以写入。打开过程中若发现上次崩溃留下的跨文件事务，会先按事务日志完成回滚或收尾，然后严格加载数据。

返回入口页会：

- 要求二次确认。
- 阻止在未处理查看器草稿或维护任务运行时切换。
- 停止为该图库领取新的后台缩略图任务。
- 清空当前图库的渲染器状态和内存索引。
- 释放锁，但保留“上次图库路径”，供下次启动自动打开。

应用采用单实例、单窗口、单活动图库模型。

## 7. 锁与并发

`library.lock` 包含：

- `LibraryId`
- `SessionId`
- `ProcessId`
- `ProcessStartedAt`
- `HostName`
- `ApplicationStartedAt`

锁使用 `wx` 创建，保证同一路径上只有一个持有者。Windows 上会同时检查 PID 和进程启动时间，降低 PID 被复用时误判活锁的风险。

规则：

- 活锁不能强制移除，即使调用底层 IPC 也必须拒绝。
- 锁文件损坏或进程已不存在时，可在显示风险和锁信息后由用户确认强制解锁。
- 主进程运行维护 worker 时继续持有图库锁，并把随机 `SessionId` 传给子进程；worker 必须验证父进程仍拥有同一把锁。
- 独立 CLI 脚本自行获取锁，不能与应用并发维护同一图库。
- 维护任务不可取消，运行期间图库只读，禁止切换图库或关闭窗口。

## 8. 持久化、备份和事务

### 8.1 严格 JSONL

所有 JSONL 采用一行一个对象。打开图库时严格检查：

- 每个非空行必须是合法 JSON 对象。
- 元数据的 `FilePath` 必须非空且唯一。
- 标签 `Text`、相册 `Title`、人物 `Name`、地点 `Name` 必须非空且在各自文件中唯一。
- 任一非法行或重复键都会拒绝整个图库加载，不跳过坏行继续运行。

这是刻意的数据安全策略：部分加载会让后续写回覆盖未加载数据，比明确失败更危险。

### 8.2 单文件原子写入

`writeTextAtomic` / `writeJsonlAtomic` 的步骤是：

1. 在目标目录创建唯一临时文件。
2. 完整写入内容。
3. 通过 rename 替换目标文件。
4. 在 `finally` 清理残留临时文件。

主进程内存 Map 只是活动会话的查询索引；JSONL 才是持久化事实来源。

### 8.3 自动备份

任何用户数据写入前必须先创建备份：

- 普通编辑和注册表创建/修改：每天第一次写入前创建 daily 快照。
- 全局删除、图库名称修改：每次创建 immediate 快照。
- 元数据增量更新：每次创建 update 快照。

备份包含 `library.yml` 和五个 JSONL，不包含原始媒体、缩略图、CSV、日志或临时文件。`backup.retentionCount` 统计快照目录，不按单文件计数；超出后删除最旧快照。备份失败必须阻止正式写入。

当前 UI 不提供备份恢复功能，备份用于人工诊断和后续恢复工具。

### 8.4 多文件事务

全局删除标签、人物、相册或地点时，通常需要同时改写注册表和 `photo_metadata.jsonl`。这些路径使用 `scripts/library-transaction.js`：

1. 在 `temp/transactions/<uuid>` 写入每个目标的新版本和旧版本。
2. 原子写入 `transaction.json`，标记 prepared。
3. 逐个原子替换目标文件，每次更新已应用数量。
4. 全部完成后标记 committed 并清理事务目录和 journal。
5. 中途异常立即从旧版本回滚所有目标。
6. 进程崩溃后，下次打开图库根据 journal 判断回滚未完成提交，或清理已经全部应用的提交。

无法解析 journal 或缺少回滚文件时拒绝打开，避免猜测数据状态。

## 9. 媒体元数据模型

`photo_metadata.jsonl` 中每个媒体是一条记录。图片和视频共用顶层结构，通过 `FileSystem.FileType` 区分。

### 9.1 顶层键

```json
{
  "FilePath": "events/example.mp4",
  "SHA256Hash": "...",
  "FileSystem": {},
  "GPS": {},
  "Location": {},
  "Camera": {},
  "Customization": {},
  "Video": {}
}
```

图片记录使用 `Picture`，不创建空 `Video`；视频记录使用 `Video`，不创建空 `Picture`。

### 9.2 `FileSystem`

- `FileType`：`image` 或 `video`。
- `FileExtension`：不带点的小写扩展名。
- `FileSize`：字节数。
- `ShootingTimeString/Zone/Stamp`：用于时间线排序的拍摄时间。
- `CreationTimeString/Zone/Stamp`：文件创建时间。
- `ModificationTimeString/Zone/Stamp`：文件修改时间。
- `ModificationTimeMs`：毫秒修改时间，位于 `FileSystem` 最后，用于增量复用判断。

图片拍摄时间优先 EXIF `DateTimeOriginal`，否则使用文件创建时间。视频拍摄时间优先容器/主流/QuickTime 创建时间，最终回退文件修改时间。

### 9.3 `Picture`

- `ProbeStatus`：`ok` 或 `failed`。
- `ProbeError`：成功时为 `null`，失败时为清理并截断后的错误。
- `Width`、`Height`、`dpi`、`BitDepth`。

图片解析失败不会删除记录。画廊显示统一占位图，查看器展示探测错误，个性化字段仍可编辑。

### 9.4 `Video`

视频规范字段包括：

- 状态：`ProbeStatus`、`ProbeError`。
- 时间和尺寸：`DurationSeconds`、编码 `Width/Height`、`DisplayWidth/DisplayHeight`、`RotationDegrees`、`SampleAspectRatio`。
- 帧率：`FrameRate`、`FrameRateRatio`。
- 视频流：`VideoCodec`、`VideoProfile`、`PixelFormat`、`BitDepth`、`BitRate`。
- 容器与流数：`ContainerFormat`、`VideoStreamCount`、`AudioStreamCount`。
- 音频：`HasAudio`、`AudioCodec`、`AudioChannels`、`AudioSampleRate`、`AudioBitRate`。
- 色彩：`ColorSpace`、`ColorTransfer`、`ColorPrimaries`。

`ProbeStatus` 取值：

- `ok`：存在并成功规范化主视频流。
- `audio-only`：容器可解析，但没有视频流。
- `failed`：FFprobe 超时、容器损坏或无法解析。

缺失的数值和字符串保存为 `null`，流数量是非负整数，`HasAudio` 是布尔值。主流优先选择 `disposition.default = 1`，否则使用同类型第一个流。

### 9.5 `GPS` 和 `Camera`

`GPS` 保存 EXIF 风格的方向和 DMS/有理数数组。视频尝试解析 QuickTime ISO 6709。`Camera` 保存品牌、型号、焦距、光圈、ISO、曝光时间和闪光灯状态；视频通常只能从容器标签取得品牌和型号，因此视频查看器不展示图片专用的相机参数表格。

### 9.6 `Customization`

- `Title`：自由文本。
- `Rating`：1 到 5；JPG/JPEG 和视频默认 2，其它图片默认 1。
- `Album`：零个或一个已注册相册标题；空字符串表示无相册。
- `Tags`：已注册标签文本数组，去重。
- `People`：已注册人物姓名数组，去重。
- `Description`：普通描述。
- `HiddenDescription`：折叠显示的隐藏描述。
- `Hidden`：隐藏媒体标记。
- `MetadataUpdateDate`：最近一次用户字段更新的 ISO 时间。

旧的 `Category` 字段不再使用；任何写入路径都会移除它。

### 9.7 `Location`

```json
{"Place":"清华大学清芬园食堂","Detail":"四楼站点披萨"}
```

- `Place`：零个或一个注册地点名称。
- `Detail`：自由文本位置细节，不进入注册表，不参与地点筛选或搜索。

## 10. 注册表模型

媒体记录继续保存可读文本键，不使用数值 ID。主进程是约束执行边界：即使绕过 UI，未注册值也不能写入元数据。

### 10.1 标签

```json
{"Text":"美食","Description":"","CreatedAt":"...","UpdatedAt":"..."}
```

- `Text` 全局唯一且不可为空。
- `Description` 允许为空，可后续编辑。
- 一个媒体可有多个标签。
- 从某个媒体移除标签不删除注册表定义。
- 全局删除会从所有媒体的 `Customization.Tags` 移除该文本。

### 10.2 相册

```json
{"Title":"Camera","Description":"相机拍摄内容","CreatedAt":"...","UpdatedAt":"..."}
```

- `Title` 全局唯一。
- 标题和说明创建时都必填，说明可后续修改但不可清空。
- 一个媒体至多属于一个相册。
- 全局删除会把所有精确引用的 `Customization.Album` 清空。

相册当前是数据归类结构，不提供封面或相册详情页。

### 10.3 人物

```json
{"Name":"张三","Description":"","CreatedAt":"...","UpdatedAt":"..."}
```

- `Name` 全局唯一且不可为空。
- `Description` 允许为空。
- 一个媒体可以关联多个人物。
- 全局删除会从所有媒体人物数组中移除该姓名。

### 10.4 地点

```json
{
  "Name":"清华大学清芬园食堂",
  "Country":"中国",
  "Province":"",
  "City":"北京",
  "Parent":"清华大学",
  "Description":"",
  "CreatedAt":"...",
  "UpdatedAt":"..."
}
```

- `Name` 是当前地点键，在整个图库内唯一；当前不支持不同城市下同名地点。
- 名称创建后不可修改。
- `Country`、`Province`、`City`、`Parent`、`Description` 均允许为空。
- 国家、省、市是地点的行政区属性，不单独构成注册表节点。若要把“南京”本身设为媒体地点，需要创建 `Name = 南京` 的普通地点记录。
- `Parent` 最多指向一个已注册地点，不能指向自身，也不能形成循环。
- 不持久化 `Children`；列表时根据 `Parent` 动态计算子节点、深度和路径。
- 地点树允许任意多层。
- 删除地点会清空精确使用该地点的媒体 `Place` 和 `Detail`，并把所有直接子节点的 `Parent` 清空；不递归删除子节点。
- 地点筛选包含选中地点及所有后代，但不包含祖先、兄弟或 `Detail` 文本。

地点列表按国家、省、市分组，再在行政区内采用父节点优先的深度优先顺序。省字段为空时，其城市分组排在有省份分组之前。子节点必须紧跟父节点及其整个子树，不能被名称相似但无父子关系的地点插入。

## 11. 扫描和增量更新

### 11.1 完整初始化

每个媒体计算完整 SHA-256。图片读取 EXIF 和 Sharp 技术信息；视频运行 FFprobe。新视频默认评级 2。

### 11.2 增量复用

`update-metadata` 用以下四项判断同路径文件是否未变化：

- 相对 `FilePath`
- `FileSystem.FileType`
- `FileSize`
- `ModificationTimeMs`

命中时复用整条记录，不重新哈希、不读 EXIF、不跑 FFprobe。旧图片若缺少 `Picture.ProbeStatus`，会在第一次更新时重建一次。

### 11.3 内容变化、移动和副本

- 同路径发生变化：重新完整哈希和探测，保留原 `Customization` 与 `Location`。
- 新路径：先完整哈希。
- 若哈希匹配一个已经消失的旧路径，视为移动/改名，继承旧技术信息和用户字段，只刷新路径与文件系统信息。
- 若同哈希旧路径仍存在，新文件视为副本，使用默认用户字段，不错误继承原文件归类。
- 多个候选按路径稳定排序后一对一匹配。
- 重建临时失败时保留同路径旧记录并报告；新媒体构建失败则跳过并报告。
- 磁盘上已消失且不可归类为临时读取失败的旧记录会被移除，其不再被任何记录使用的 hash 缩略图也被清理。

重复 SHA-256 允许存在。日志列出重复路径；需要按 hash 选择源文件时，使用稳定顺序中的第一个，其它副本不影响浏览。

## 12. 缩略图管线

缩略图固定存为：

```text
.photo_manager/thumb_cache/<SHA256Hash>.webp
```

同内容媒体共享缓存文件。`cache_manifest.json` 记录尺寸、质量、极端长宽比阈值和生成器版本；配置或生成器版本变化时，缓存视为 stale 并重建。

- 普通图片：Sharp 中心裁切为正方形。
- 极高图片：优先裁切顶部正方形区域。
- 极宽图片：优先裁切左侧正方形区域。
- 视频：FFmpeg 抽取代表帧为临时 PNG，再由 Sharp 生成 WebP。

视频目标帧时间：

```text
min(max(DurationSeconds * 0.1, 1), 10, DurationSeconds / 2)
```

目标时间失败时回退第一帧；仍失败则使用视频占位图。图片解析失败使用图片占位图。视频缩略图默认串行，图片使用应用级并发数。

打开图库后渲染器显式请求后台补齐缺失缩略图。后台任务不阻塞窗口；单项生成后主进程发送 `thumbnail:ready`，画廊局部刷新。关闭图库或开始维护任务时，不再为旧会话领取新缩略图任务。

## 13. 视频播放

### 13.1 原生播放与降级

- 优先使用 `<video controls preload="metadata">`，封面作为 poster，不自动播放，不循环。
- 原生画面解码失败但元数据表明有音轨时，尝试 `<audio controls>` 播放同一文件，并提示仅播放音频。
- 音频也失败、无音轨或探测失败时，显示不可播放状态、封面/占位图、错误原因和“用系统播放器打开”。
- MKV、AVI、HEVC 等 Chromium 不支持的编码可以通过 Windows 默认播放器作为正式回退路径。
- 不生成代理视频，不把运行时播放错误写回媒体 JSONL。

### 13.2 播放状态和偏好

跨会话保存应用级音量、静音和倍速：

```text
photoManager.videoVolume
photoManager.videoMuted
photoManager.videoPlaybackRate
```

虽然界面不提供独立倍速控件，原生控件或运行时变更仍按上述键持久化。播放位置不记忆；切换媒体后从 0 开始，但继承音量、静音和倍速。

切换、关闭或销毁播放器前必须暂停、移除 `src` 并调用 `load()`，避免后台残留声音和文件句柄。

### 13.3 键盘和逐帧

需要区分“尚未开始播放”和“已经开始过”：

- 新进入视频，尚未播放、拖动或逐帧：`←/→` 切换上一/下一媒体。
- 视频一旦播放过、进度被拖离起点或执行逐帧，即使当前暂停或播放结束：`←/→` 快退/快进 5 秒。
- 已开始过的视频使用 `Shift+←/Shift+→` 切换媒体。
- `Space` 播放/暂停。
- `,` / `.` 或底栏图标执行上一帧/下一帧。
- 逐帧使用 `1 / FrameRate` 近似定位；未知帧率时禁用，可变帧率不建立精确索引。
- 双击媒体区域进入全屏。

输入框、文本域、选择器、弹窗或其它可编辑控件获得焦点时，不触发媒体快捷键。

## 14. 画廊查询和筛选

`gallery:query` 在主进程内存索引上按顺序执行：

1. 排除 `Customization.Hidden = true`。
2. 应用媒体类型筛选：全部、图片、视频。
3. 应用相册、标签、人物、地点筛选，多个维度取交集。
4. 应用文本搜索。
5. 排序。
6. 按拍摄日期分组。

图片和视频在同一时间线混排。总数文案使用“媒体”。卡片显示封面、标题、评级和显示分辨率；视频画面右下角显示时长，卡片底栏不重复显示时长。

画廊不执行应用级分页。每次查询都返回当前筛选、搜索和排序条件下的完整匹配结果，renderer 将完整结果保存为浅响应式集合并一次创建全部卡片。缩略图元素保留浏览器原生 `loading="lazy"`，因此完整结果、全选和查看器导航不受可见范围限制，但 Chromium 可以延迟读取和解码远离视口的缩略图。当前实现不使用虚拟网格；如果未来图库规模需要虚拟化，应保持完整结果语义，只替换卡片渲染层。

“全选”表示选择当前完整查询结果中的全部媒体，而不是仅选择可见卡片。查看器直接复用同一有序结果，首尾判断基于完整结果长度。查询请求使用递增序号，较早请求即使较晚返回，也不能覆盖用户最后一次筛选或排序产生的结果。

顶部相册、标签、人物、地点筛选器使用只读触发框，搜索框位于下拉菜单内部。当前选择和 hover 使用不同深浅的半透明蓝色背景。地点菜单展示行政区层级和地点树。

## 15. 查看器和个性化编辑

查看器三栏：

- 左栏：文件信息和媒体类型专属技术参数。
- 中栏：图片操作区或视频/音频播放器。
- 右栏：图片和视频共用的个性化信息。

图片支持缩放、拖动、旋转、镜像、复原、全屏和复制图像。视频隐藏图片工具，不提供复制视频二进制、定位文件或倍速按钮；保留逐帧、全屏和系统播放器图标。

右栏字段：标题、评级、相册、地点、位置细节、人物、标签、描述、隐藏描述。小标题使用粗体。位置细节和隐藏描述采用无独立文字行的折叠提示：折叠控制放在所属主字段标题右侧；位置细节文本框展开后缩进，隐藏描述不缩进。折叠状态跨媒体共享。

相册、地点、人物和标签均使用“只读触发框 + 菜单内搜索 + 外置新建/管理按钮”。同一时刻只允许一个下拉菜单打开，点击当前菜单及触发框以外的区域会关闭它。

人物、标签和地点选择菜单顶部显示当前图库 UUID 隔离的最近使用三项；提示标签使用圆角小标签并与全部列表用分隔线区分。地点列表另外使用固定、不覆盖滚动列表的行政区上下文条，只显示国家/省/市，不显示父地点。

## 16. 地点层级展示

地点选择、顶部地点筛选和地点管理三处必须共享相同的排序基础：

- 第一层国家顶格。
- 第二层省；空省份分组排在同国其它省之前。
- 第三层城市。
- 行政区内，根地点按稳定名称序排列。
- 每个父地点后立即递归展示全部子树；缩进按地点深度增加。

地点管理面板中的卡片不重复显示底部行政区、父节点或说明块。说明与名称同一行，过长时换行；卡片左边缘按地点层级缩进。滚动区域上方的固定上下文条根据当前可见第一张卡片显示其国家、省、市，避免覆盖卡片造成计算偏差。

## 17. 注册表管理面板

标签、相册、人物、地点管理面板均支持：

- 搜索定义和说明。
- 显示媒体使用数量。
- 修改允许编辑的说明或地点属性。
- 二次确认全局删除，并明确影响媒体数量。
- 右上角 `+` 创建尚未被任何媒体使用的新定义。
- 右上角 `×` 关闭。

从管理面板创建时，创建表单是独立悬浮在管理面板之上的 modal；关闭创建表单不能关闭下层管理面板。地点创建表单的父节点触发框不可编辑，搜索框位于下拉列表内。

全局删除成功后管理面板保持打开，列表、筛选项、当前查看媒体和画廊本地缓存同步更新。

## 18. 图库设置菜单和维护任务

画廊右下角齿轮仅在画廊普通模式显示。菜单使用图标加文本，提供：

- 图库信息：名称、完整路径、UUID、创建时间、更新时间、媒体统计；可打开图库根目录和管理目录。
- 更新元数据。
- 检查元数据。
- 生成缩略图。
- 导出元数据 CSV。
- 相册、地点、人物、标签管理。
- 退出当前图库并返回图库入口。

维护任务通过 `scripts/maintenance-worker.js` 在 child process 中运行，向主进程发送结构化进度、日志和结果。UI 展示阶段、计数、当前相对路径和最终 JSON 报告，可复制报告或打开日志目录。CSV 完成后可在资源管理器中定位文件。

### 18.1 更新元数据

- 增量扫描并原子替换完整 metadata JSONL。
- 执行前创建 update 备份。
- 完成后主进程重新严格加载全部索引并刷新画廊。
- 随后后台补齐缺失缩略图。

### 18.2 检查元数据

只读，不修复：

- 扫描全部支持媒体并重算完整 SHA-256。
- 报告 metadata 缺失项、磁盘缺失项、hash 变化、类型不符、探测失败和读取失败。
- 可选 `--probe` / UI 复选框重新运行 FFprobe，并比较状态、时长、主流尺寸和编码。

### 18.3 生成缩略图

- 默认只生成缺失或因 manifest 不匹配而 stale 的缓存。
- 可选强制重建全部缓存。
- 不修改媒体元数据。

### 18.4 CSV 导出

- UI 固定输出 `.photo_manager/data/photo_metadata.csv`。
- 文件存在时必须二次确认覆盖。
- CSV 展平用户字段、地点、文件系统、图片/视频技术字段、GPS 和相机字段。
- 图片行的视频列为空，视频行的图片列为空。
- 地点只导出 `Location.Place` 和 `Location.Detail`，不把国家/省/市复制进每个媒体行。

## 19. CLI 维护接口

所有图库脚本都要求显式 `--library`，不读取旧式路径配置：

```powershell
npm run init-metadata -- --library "D:\Media\My Library"
npm run update-metadata -- --library "D:\Media\My Library"
npm run verify-metadata -- --library "D:\Media\My Library"
npm run verify-metadata -- --library "D:\Media\My Library" --probe
npm run build-thumbnails -- --library "D:\Media\My Library"
npm run build-thumbnails -- --library "D:\Media\My Library" --force
npm run export-metadata-csv -- --library "D:\Media\My Library"
```

缺少 `--library` 必须立即失败。独立脚本和应用 UI 使用同一 library path、锁、严格加载和 FFmpeg 配置模块。

## 20. IPC 契约

主要请求通道：

- 配置：`app:get-config`、`app:update-config`。
- 图库生命周期：`library:get-state`、`library:choose-directory`、`library:inspect`、`library:open`、`library:initialize`、`library:close`、`library:update-info`。
- 初始化辅助：`library:cancel-scan`、`library:cancel-initialization`、`library:cleanup-failed-initialization`、`library:recheck-media-tools`。
- 文件夹入口：`library:open-root`、`library:open-manager-dir`、`library:open-log-dir`。
- 维护：`maintenance:get-state`、`maintenance:start`、`maintenance:show-output`。
- 查询和编辑：`gallery:query`、`photo:update-customization`、`photo:batch-update`。
- 四类注册表：各自的 list/create/update/delete-global。
- 桌面能力：`photo:copy-path`、`photo:copy-json`、`photo:copy-image`、`photo:open-default`、`photo:show-in-folder`、`clipboard:write-text`。
- 视频诊断：`photo:report-playback`。
- 缩略图：`thumbnail:start-warmup`。
- 窗口：`window:action`、`window:get-state`。

事件通道：

- `library:state-changed`
- `library:progress`
- `maintenance:progress`
- `maintenance:completed`
- `thumbnail:ready`
- `window:state-changed`

所有媒体路径相关 IPC 必须先从当前 `metadataIndex` 找到记录，再验证最终路径仍在活动图库内。不能接受渲染器直接传入任意绝对路径来执行系统打开或图像复制。

## 21. 源码职责

### 21.1 `scripts/`

- `library-core.js`：图库路径、manifest、严格 JSONL、原子写入、嵌套检测。
- `library-access.js`：现有图库验证、CLI/worker 授权。
- `library-lock.js`：锁创建、活性检查、释放和强制解锁边界。
- `library-backup.js`：快照和保留数量。
- `library-transaction.js`：多文件提交 journal、回滚和崩溃恢复。
- `operation-progress.js`：统一进度和 warning/error 收集。
- `maintenance-worker.js`：Electron 维护子进程入口。
- `common.js`：扫描、hash、图片/视频记录构造、默认用户字段。
- `media-tools.js`：FFmpeg 配置、execFile、超时、FFprobe 规范化、抽帧。
- `thumbnail-cache.js`：共享缩略图生成和并发队列。
- `init-metadata.js`：新图库初始化。
- `update-metadata.js`：增量同步。
- `verify-metadata.js`：只读完整性检查。
- `build-thumbnails.js`：缓存生成。
- `export-metadata-csv.js`：CSV 导出。
- `start-electron.js`：清理不应继承的 Electron 环境变量并启动桌面进程。

### 21.2 `src/main/`

- `main.js`：主进程组合根。创建运行时状态，装配各领域服务，协调图库生命周期、索引加载、维护 worker 和缩略图后台任务；不再直接承载成组的 IPC CRUD 或窗口构造细节。
- `application-runtime.js`：创建单一主进程运行时对象，集中保存活动窗口、活动图库、五类内存索引、维护状态、worker 和缩略图任务状态。每次调用必须返回彼此隔离的新状态，模块不得另建同语义的全局单例。
- `application-config.js`：读取、规范化、深度合并并保存应用级 `config.yml`。该模块不读取图库数据。
- `simple-registry-catalog.js`：标签、人物和相册共享的注册表加载、历史引用补齐、使用量统计、排序、写回和引用校验逻辑。
- `simple-registry-service.js`：标签、人物和相册共享的创建、修改说明、全局删除、备份及内存回滚流程；字段名和删除媒体引用的方式由显式配置传入。
- `location-domain.js`：不执行 I/O 的地点规范化、父子图、后代集合、路径和循环校验逻辑。
- `location-catalog.js`：地点注册表加载、历史地点迁移、非法父关系清理、媒体地点结构规范化、使用量统计和持久化协调。
- `location-registry-service.js`：地点创建、编辑和全局删除。地点保留专门服务，因为删除父节点、解除子节点父关系和清空媒体地点不符合简单注册表模型。
- `gallery-query.js`：不执行 I/O 的画廊过滤、搜索、排序和完整结果日期分组逻辑；地点筛选通过注入的后代查询实现，不包含分页职责。
- `metadata-edit-service.js`：单媒体和批量个性化信息更新、注册表引用校验、保存失败后的内存回滚。
- `thumbnail-warmup-service.js`：当前图库缩略图 manifest 校验、后台补齐、会话取消检测和 renderer 完成事件。
- `ipc-handlers.js`：显式注册 renderer 可访问的 IPC 白名单，将参数转交领域服务，并封装剪贴板、系统打开和资源管理器定位等 Electron 能力。它不拥有活动图库状态。
- `window-manager.js`：BrowserWindow 创建、渲染器诊断、最大化状态通知、维护期间关闭拦截和初始化取消确认。
- `preload.js`：`contextIsolation` 下唯一允许的 renderer bridge。

主进程依赖方向固定为：`main.js` 负责装配，`ipc-handlers.js` 调用领域服务，领域服务通过显式 getter/setter 访问 `application-runtime.js` 中的活动会话和索引，底层再调用 `scripts/library-*` 持久化工具。领域模块不能反向导入 IPC 注册器或主窗口。

### 21.3 `src/renderer/`

- `App.vue`：跨视图状态、完整画廊结果、注册表状态、编辑草稿、媒体播放、modal 和全局交互协调；使用请求序号丢弃过期画廊响应，并以 `FilePath` 索引同步缩略图完成事件。
- `LibraryEntryView.vue`：选择图库、媒体工具错误、进度和重试。
- `GalleryView.vue`：不分页的混合媒体画廊和覆盖完整查询结果的批量编辑；卡片缩略图使用浏览器原生懒加载。
- `ViewerView.vue`：媒体查看器和技术信息。
- `GallerySettingsMenu.vue`：图库设置入口。
- `AlbumPicker.vue`、`PeoplePicker.vue`、`TagPicker.vue`、`LocationPicker.vue`：查看器/批量选择控件。
- `RegistryFilterPicker.vue`、`LocationFilterPicker.vue`：画廊筛选控件。
- `video-playback.mjs`：逐帧目标和方向键状态规则的纯函数。
- `styles.css`：全局设计系统、三视图布局、下拉菜单和 modal。

## 22. 测试与验收

自动化测试使用 Node 内置 `node:test`：

- CSV 列和转义。
- 图库路径、manifest、严格 JSONL、嵌套边界。
- 图片损坏探测。
- 独占锁和备份保留。
- 多文件事务部分提交回滚。
- 内置 FFmpeg 集成、损坏视频、缩略图生成与临时文件清理。
- FFprobe 字段规范化、日期/GPS/设备映射、超时和错误清理。
- 增量更新的复用、变更、移动、副本和失败保留。
- 视频逐帧和键盘状态规则。
- 主进程配置合并、运行时隔离、地点层级、画廊组合筛选和通用注册表统计。

提交前最低验证：

```powershell
npm test
npm run build:renderer
node --check src/main/main.js
node --check src/main/preload.js
node --check scripts/*.js  # PowerShell 中应逐文件执行或使用可靠循环
npm run verify-metadata -- --library "<library-path>"
git diff --check
```

桌面端还应手工检查入口页、自动打开、锁提示、画廊设置菜单、维护任务进度、返回入口、图片查看和视频播放降级。

## 23. 开发约束和不变量

后续修改必须维持：

1. 不重新引入项目级 `workspaceRoot`、`dataDir`、`logDir` 或可配置数据文件名。
2. 不在图库根目录外写入图库专属数据。
3. 不允许渲染器直接读写文件系统。
4. 不允许媒体保存未注册标签、相册、人物或主地点。
5. 不把 `Location.Detail` 纳入地点注册表或地点筛选。
6. 不把地点 `Children` 持久化；它必须由 `Parent` 派生。
7. 不允许地点父链循环。
8. 不允许维护脚本在缺少显式 `--library` 时猜测路径。
9. 不在 JSONL 损坏时跳过行继续打开。
10. 不在全局删除时用两个无恢复关系的独立写入替代事务。
11. 不在备份失败后继续正式写入。
12. 不因技术探测失败而剥夺媒体的个性化编辑能力。
13. 不对未变化的大视频重复完整哈希或 FFprobe。
14. 不在切换媒体或图库后保留视频声音、旧下拉菜单或旧图库最近使用状态。

## 24. 当前明确不做的功能

- 数据库、云同步、多用户和跨进程协同编辑。
- 最近图库列表。
- 图库嵌套、符号链接媒体和图库外媒体引用。
- 自动文件系统监控。
- 相册详情页、相册封面。
- 照片组数据结构。
- 地点稳定 ID 和跨行政区同名地点；当前仍以 `Name` 为唯一键。
- 视频代理转码、字幕、章节、多音轨切换、手动封面、播放位置记忆、循环和截图。
- 精确可变帧率逐帧索引。
- UI 内备份恢复。

## 25. 架构总结

PhotoManager 当前采用“应用级代码与配置 + 用户选择的独立图库 + 图库内自包含管理目录”的模型。Electron 主进程持有唯一活动图库会话和所有写权限；维护脚本共享图库边界、锁和持久化模块；Vue 渲染层只处理交互与可序列化状态。每个图库可连同 `.photo_manager` 一起移动和备份，不依赖项目目录中的数据路径。
