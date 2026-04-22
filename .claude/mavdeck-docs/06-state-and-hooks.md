# 状态管理与 Hooks（store/ + hooks/）

## store/ 模块

### app-store.ts — 中央应用状态

**技术**：SolidJS `createStore`（模块级全局状态，非 Context）

**导出**：
```typescript
const [appState, setAppState] = createStore(createInitialAppState())

function createInitialAppState(): AppState
function applySettingsToAppState(settings: PersistedSettingsState): void
function mergeAppStateIntoSettings(): PersistedSettingsState
```

**关键状态字段**：

#### 连接状态
- `connectionStatus`: `'disconnected' | 'connecting' | 'connected' | 'no_data' | 'error'`
- `connectionSourceType`: `'spoof' | 'serial' | 'external' | 'log'`
- `baudRate`, `connectedBaudRate`
- `throughputBytesPerSec`
- `autoConnect`, `autoDetectBaud`
- `probeStatus`
- `webusbAvailability`
- `lastPortVendorId`, `lastPortProductId`, `lastPortSerialNumber`
- `lastSuccessfulBaudRate`

#### UI 状态
- `theme`: `'dark' | 'light'`
- `uiScale`: number（0.5 - 2.0）
- `activeTab`: `'telemetry' | 'map' | 'parameters'`
- `activeSubTab`: string（标签页内子标签）
- `isSettingsOpen`, `isHelpOpen`
- `sidebarCollapsed`, `sidebarWidth`
- `isLogPaneCollapsed`
- `debugConsoleEnabled`

#### 绘图状态
- `plotTabs: PlotTab[]` — 标签页数组
- `timeWindow`: TimeWindow（5, 10, 30, 60, 120, 300 秒）
- `addPlotCounter` — 用于生成唯一 ID

#### 地图状态
- `mapShowPath`, `mapTrailLength`
- `mapLayer`: `'street' | 'satellite' | 'hybrid'`
- `mapZoom`, `mapCenterLat`, `mapCenterLon`
- `mapAutoCenter`

#### 日志状态
- `logViewerState`: `{ isActive, sourceName, durationSec, recordCount }`
- `logsVersion` — 用于触发日志库刷新

#### 其他
- `isPaused`: boolean
- `isReady`: boolean（初始化完成）
- `bufferCapacity`: number（环形缓冲区容量）
- `offlineReady`, `offlineStatus`, `offlineError`
- `updateAvailable`
- `dialectName`

**标签页管理操作**：
```typescript
function addPlotTab(): void
function deletePlotTab(tabId: string): void
function renamePlotTab(tabId: string, name: string): void
function reorderPlotTabs(newOrder: PlotTab[]): void
function setActiveSubTab(tabId: string): void
```

**设计模式**：
- `PersistedSettingsState` 类型：提取应持久化到磁盘的字段
- `batch()` 用于 `applySettingsToAppState` 和标签变更，减少重渲染
- 标签 ID：`Date.now()` + 随机后缀
- 标签名自动递增："Tab 1", "Tab 2"...
- `mergeAppStateIntoSettings`：将当前 store 值拉回到 settings 对象供持久化

### session-status.ts — 状态栏推导

**导出**：
```typescript
function selectStatusBarModel(state: AppState, serialSupported: boolean): StatusBarModel

interface StatusBarModel {
  headline: string
  headlineTone: 'neutral' | 'success' | 'warning' | 'danger'
  badges: string[]
  details: string[]
}
```

**两种模式**：

1. **日志回放**：显示源名称、时长、记录数、方言
2. **实时连接**：显示连接标签、波特率、吞吐量、方言，以及条件徽章：
   - Simulator、Paused、Waiting for Data、Probing、Error、Serial Unavailable

### 测试
- `app-store.test.ts`：初始默认值、`setAppState` 变更
- `session-status.test.ts`：暂停串口链接和日志回放的状态栏模型

---

## hooks/ 模块

### use-bootstrap.ts — 应用初始化编排器

**步骤**：
1. `recoverStagedSessions()` — 日志崩溃恢复
2. `loadSettings()` → `applySettingsToAppState()`
3. 方言加载优先级：远程 URL → 缓存 → 捆绑包回退
4. 初始化：`MavlinkMetadataRegistry`, `MavlinkWorkerBridge`, `ConnectionManager`, `SerialSessionController`, `LogViewerService`
5. 绑定会话状态同步、日志查看器状态、吞吐量、加载完成回调到 store
6. 设置 `isReady = true`

**清理**：取消所有监听器、卸载日志、断开连接、释放 bridge

### use-settings-sync.ts — 设置持久化与同步

**Effect 1 — 持久化**：
- 防抖保存设置（显示/连接偏好变化时）

**Effect 2 — 波特率同步**：
- 监视 baudRate + `autoDetectBaud` + 连接状态
- 如果手动串口活跃且波特率不匹配 → `reconnectLiveSerial()`

**Effect 3 — 缓冲区容量**：
- 立即同步到 Worker

**Effect 4 — 暂停/恢复**：
- 同步到 ConnectionManager（仅当已连接且不在日志回放时）

**刷新**：`beforeunload` 和 `visibilitychange` 时 flush 设置

### use-auto-connect.ts — 自动连接生命周期

**逻辑**：
- 当 `isReady` 和 `autoConnect` 都为 true 时：
  - 委托 `serialController.syncAutoConnect()`（原生）
  - 或 `syncAutoConnectWebUsb()`（Android/WebUSB）
- 日志回放活跃时暂停自动连接
- 尊重 `hasSuspendedLiveSession` 和 `isManualSerialReconnectInProgress` 标志

### use-interested-fields.ts — 兴趣字段收集

**逻辑**：
1. 收集所有可见信号：`appState.plotTabs` 中所有 `PlotSignalConfig` 的 `fieldKey`
2. 加上硬编码 `MAP_REQUIRED_FIELDS`
3. 调用 `workerBridge.setInterestedFields([...interested])`

**为什么重要**：
- Worker 只推送 UI 需要的字段数据
- 减少主线程处理压力和内存占用

### use-log-session.ts — 日志会话录制

**流程**：
- `onLogSessionStart` → `stageSessionStart`
- `onLogChunk` → 链式 `stageSessionChunk`
- `onLogSessionEnd` → `finalizeSession`
- 成功时递增 `logsVersion` 触发库刷新

### use-log-library.ts — 日志库 UI 状态

**返回信号**：
- `entries`, `loading`, `error`
- `editing`, `deleting`, `busyFile`
- `menuOpenFile`, `clearingAll`
- `selectedFiles`, `lastClickedFile`, `deletingSelected`

**处理器**：load, unload, edit, export, delete（单文件/选中/全部）, collapse

**设计**：本地 UI 状态使用 `createSignal`；`createEffect` 监视 `appState.logsVersion` 重新加载

### use-keyboard-shortcuts.ts — 全局快捷键

**快捷键**：
- `Escape`：关闭帮助覆盖层
- `Space`：切换暂停（仅当已连接且不在日志回放时）

**忽略条件**：焦点在 input/textarea/select/contenteditable 内时忽略

### use-parameters.ts — 参数管理状态

**特点**：模块级状态，Tab 切换时保留

**模块级信号**：
- `paramState: ParameterStateSnapshot`
- `metadata: Map<string, ParamDef>`
- `lastSetResult: ParamSetResult | null`
- `metadataLoading`, `metadataStatus`

**Bridge 初始化**：
- `ensureBridge()` 设置应用生命周期订阅：`onParamState`, `onParamSetResult`
- 使用 `createRoot()` 实现：
  - 连接时自动读取参数
  - 获取完成时自动下载元数据

**操作**：
- `requestAll()`
- `setParam(name, value)`
- `loadMetadataFromUrl(url)`
- `loadMetadataFromFile(file)`
- `downloadMetadataFromDevice()`

**派生数据**：
- `metadataLookup`（memo）
- `groupedParams`（memo，使用 `buildParamGroups()`）

### use-status-text-capture.ts — STATUSTEXT 捕获

**逻辑**：
- 日志源变化时清除条目
- 就绪时订阅 `workerBridge.onStatusText`

---

## 测试文件

| 测试文件 | 覆盖内容 |
|---------|---------|
| `use-auto-connect.test.ts` | 日志期间暂停、WebUSB 路径、阻塞重启、序列号透传 |
| `use-parameters-device-metadata.test.ts` | 元数据 JSON 主体的调试控制台日志 |
| `use-parameters.test.ts` | `buildParamGroups` 分组逻辑（回退前缀、显式分组、shortDesc 前缀、数组构建）|
| `use-settings-sync.test.ts` | 波特率变更重连逻辑、尊重自动波特率 |

---

## 状态管理关键模式

1. **模块级 `createStore`**：`appState` 全局可访问，非 Context 传递。组件直接读取 `appState.fieldName`。
2. **`batch()` 批量更新**：多处使用 `batch(() => { ... })` 减少中间渲染。
3. **派生状态分离**：`session-status.ts` 将原始状态推导为 UI 展示模型，保持 store 精简。
4. **设置持久化管道**：`applySettingsToAppState`（加载）→ store 变更 → `mergeAppStateIntoSettings` → `saveSettingsDebounced`（保存）。
5. **模块级 Hook 状态**：`useParameters` 的信号在模块顶部定义，组件 mount/unmount 不丢失状态。
6. **版本触发刷新**：`logsVersion` 递增触发 `useLogLibrary` 重新加载。
7. **`createRoot` 管理副作用**：在 `useParameters` 和 `ParametersView` 的 Save All 中使用 `createRoot` 管理异步参数设置的生命周期。
