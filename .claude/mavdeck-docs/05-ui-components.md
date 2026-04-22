# UI 组件层（components/ 模块）

## 文件列表

| 文件 | 职责 |
|------|------|
| `App.tsx` | 主应用结构，挂载所有全局组件和钩子 |
| `ThemeProvider.tsx` | 主题切换（light/dark）|
| `Toolbar.tsx` | 顶部工具栏：连接、暂停、添加绘图、设置 |
| `TelemetryView.tsx` | 遥测视图主布局：侧边栏 + 绘图区 |
| `GridLayout.tsx` | Gridstack 集成（关键 SolidJS 隔离模式）|
| `PlotPanel.tsx` | 单个绘图面板（标题栏 + 图表区）|
| `PlotChart.tsx` | uPlot 图表渲染和交互 |
| `PlotTabBar.tsx` | 绘图标签栏：切换、重命名、拖拽排序、删除 |
| `SignalSelector.tsx` | 信号选择模态框 |
| `MapView.tsx` | Leaflet 地图（实时/回放模式）|
| `MessageMonitor.tsx` | 消息监控侧边栏（消息列表 + 字段 + 频率）|
| `StatusTextLog.tsx` | 状态文本日志（可折叠底部面板）|
| `LogLibraryPane.tsx` | 日志库面板（加载/导出/删除日志）|
| `ParametersView.tsx` | 参数视图主布局（两栏：列表 + 详情）|
| `ParameterGroup.tsx` | 参数分组（可折叠）|
| `ParameterRow.tsx` | 单行参数显示 |
| `ParameterDetail.tsx` | 标量参数详情/编辑面板 |
| `ParameterArrayDetail.tsx` | 数组参数详情/编辑面板 |
| `StatusBar.tsx` | 底部状态栏 |
| `SettingsModal.tsx` | 设置模态框（4 个标签页）|
| `HelpOverlay.tsx` | 帮助覆盖层 |
| `InstallPrompt.tsx` | PWA 安装/更新提示 |
| `DebugConsole.tsx` | 调试控制台（可折叠底部）|
| `TabBar.tsx` | 遗留简单标签栏（当前未使用）|
| `hooks.ts` | 组件工具：toggleSetItem |
| `index.ts` | Barrel 导出 PlotTabBar |

---

## App.tsx — 应用根结构

```tsx
<ThemeProvider>
  <RuntimeServicesProvider>
    <AppContent />
  </RuntimeServicesProvider>
</ThemeProvider>
```

**AppContent 挂载**：
- `Toolbar`
- Tabbed `main`：`TelemetryView` / `MapView` / `ParametersView`
- `DebugConsole`
- `StatusBar`
- `HelpOverlay`

**AppContent 使用的 Hooks**：
- `useSettingsSync` — 设置持久化和同步
- `useAutoConnect` — 自动连接生命周期
- `useInterestedFields` — 兴趣字段收集
- `useLogSession` — 日志会话录制
- `useKeyboardShortcuts` — 全局快捷键
- `useStatusTextCapture` — STATUSTEXT 捕获

**Tab 切换**：`handleSelectTab` 更新 store 并持久化 `activeTab`

---

## ThemeProvider.tsx

- 响应式切换 `<html>` 元素的 `light` 类
- 设置 CSS 自定义属性 `--ui-scale`（来自 `appState.uiScale`）

---

## Toolbar.tsx — 顶部工具栏

**左侧**：
- 分段按钮：Telemetry / Map / Parameters
- 日志模式指示器

**右侧**：
- Install prompt（PWA 安装/更新）
- 串口连接/断开（手动或自动连接模式）
- 暂停/恢复
- 卸载日志
- 添加绘图
- 时间窗口选择器
- 设置按钮

**串口逻辑**：
- 区分原生 Web Serial vs Android WebUSB
- 自动连接模式下显示 "Grant Access"
- 显示探测状态文本

---

## TelemetryView.tsx — 遥测视图主布局

**布局**：可折叠左侧边栏 + 右侧绘图区

**侧边栏**：
- `MessageMonitor`（可点击字段列表）
- `LogLibraryPane`
- 底部 `StatusTextLog`
- 可通过指针拖拽调整宽度

**绘图区**：
- `PlotTabBar` + `For each={appState.plotTabs}` 渲染 `GridLayout`

**状态管理**：
- `selectedPlotId`：当前选中的绘图（用于侧边栏点击添加信号）
- `selectorPlotId`：打开信号选择器的绘图 ID
- `layoutRestored`：布局恢复门控

**持久化**：
- 通过 `idb-keyval` 保存/恢复绘图标签和布局（`mavdeck-layout-v2`）
- 支持 v1→v2 迁移
- 保存/恢复 `activeSubTab`

**交互控制器**：
- `createPlotInteractionController()` — 跨绘图联动缩放/平移
- `isPaused` 与交互控制器双向同步：暂停冻结图表在"现在"，恢复重置到实时

---

## GridLayout.tsx — Gridstack + SolidJS 集成（关键模式）

这是 CLAUDE.md 中强调的**关键架构模式**。

**为什么需要特殊处理**：
- Gridstack 直接操作 DOM 进行定位和排序
- SolidJS 也操作 DOM（虚拟 DOM 协调）
- 两者如果在同一 DOM 节点上会产生冲突

**解决方案**：

```typescript
// 1. 初始化 GridStack
const grid = GridStack.init({ column: 12, ... }, containerRef)

// 2. 为每个绘图配置手动创建 DOM 节点
const wrapper = document.createElement('div')
wrapper.className = 'grid-stack-item'
const content = document.createElement('div')
content.className = 'grid-stack-item-content'
wrapper.appendChild(content)
containerRef.appendChild(wrapper)

// 3. 让 Gridstack 接管这个 widget
grid.makeWidget(wrapper, { x, y, w, h, id })

// 4. SolidJS 只挂载到 content div 内部
const dispose = render(() => <PlotPanel ... />, content)

// 5. 清理时：先卸载 SolidJS，再移除 Gridstack widget
// 添加绘图：dispose() → grid.removeWidget(el)
// 绘图列表变化：createEffect diff 后 add/remove widgets
```

**动画处理**：
- 首次挂载后延迟启用动画，避免标签切换时的视觉噪音

---

## PlotPanel.tsx — 绘图面板

**标题栏**：
- 可拖拽（`cursor-grab`）
- 内联信号芯片（带颜色点）
- 使用 `ResizeObserver` + 隐藏测量 div 计算可容纳的芯片数量
- 溢出显示 "+N more" 徽章
- 双击打开 `SignalSelector`

**主体**：
- 有信号时渲染 `PlotChart`
- 无信号时显示 "Add signals" 空状态

**操作**：
- 清除所有信号
- 关闭绘图

---

## PlotChart.tsx — uPlot 图表

**图表库**：`uPlot`

**数据流**：
1. 订阅 `workerBridge.onUpdate(buffers)`
2. Buffers 格式：`Map<string, { timestamps: Float64Array; values: Float64Array }>`

**重采样**：`resampleSampleAndHold()`
- 将不同时间戳的信号对齐到最长的时间戳数组
- 使用零阶保持（最近邻插值）

**单位转换**：`convertDisplayValues()`
- 应用单位配置文件转换（raw → metric/imperial）

**交互**：
- 滚轮缩放 → `interactionController.emitZoom()`
- 双击 → `interactionController.emitReset()`
- 光标同步：`interactionGroupId` 链接所有图表
- Tooltip 插件显示光标处的系列值

**Effect 重建条件**：
- 主题变化
- 单位配置变化
- 信号键变化

**时间窗口**：`timeWindow` 变化时，live 模式下更新范围

---

## SignalSelector.tsx — 信号选择器

**模态框**：固定覆盖层

**数据**：订阅 `workerBridge.onAvailableFields(fields)`

**分组**：按消息类型分组 `messageName.fieldName`

**选择**：
- 复选框切换信号
- 颜色点显示已分配颜色

---

## PlotTabBar.tsx — 绘图标签栏

**功能**：
- 点击切换标签
- 双击（或触摸长按）重命名内联
- 拖拽排序
- 删除确认（如果绘图存在）
- 添加新标签

**持久化**：任何变更调用 `onLayoutDirty`

---

## MapView.tsx — 地图

**库**：Leaflet (`L`)

**图层**：
- Street：CARTO Voyager
- Satellite：Esri
- Hybrid：Esri + CARTO labels

**飞行器标记**：
- 自定义 `L.divIcon`，SVG 箭头按航向旋转

**轨迹**：
- `L.polyline`，颜色根据图层自适应对比度

**日志模式**：
- `showFullFlightPath()`：绘制完整路径，添加绿色起点/红色终点标记，适应边界，禁用自动居中
- `clearLogFlightPath()`：恢复实时模式

**实时模式**：
- 追加点到 `mapTrailLength` 上限
- 如果启用则自动居中

**覆盖层**：
- 右上角显示 lat/lon/alt/hdg（带单位转换）
- 图层切换、轨迹切换、自动居中切换

---

## ParametersView.tsx — 参数视图

**布局**：两栏，可调整分隔线

**左栏**：
- Read 按钮
- Save All 按钮（带待处理计数）
- Read Metadata 按钮
- 搜索输入框
- 进度条
- 可滚动列表（`ParameterGroup` 数组）

**待处理编辑**：
- 本地状态 `Map<string, number>`
- `modifiedParamIds` memo 比较待处理值和设备值

**Save All**：
- 依次发送 `setParam`，等待 `lastSetResult` 确认
- 每个参数 5 秒超时
- 使用 `createRoot` 管理生命周期

**右栏**：
- `ParameterDetail`（标量参数）或 `ParameterArrayDetail`（数组参数）

---

## ParameterGroup.tsx

- 可折叠分组头（箭头、名称、条目数）
- 标量参数通过 `ParameterRow` 列出
- 数组分组显示为可点击行，显示编辑摘要

---

## ParameterRow.tsx

- 字段名、值、单位
- 待编辑箭头（→）
- 已修改/默认值圆点
- 需要重启警告徽章

**格式化**：
- Boolean → ON/OFF
- Discrete → 描述查找
- 数值 → `toFixed(decimalPlaces)`

---

## ParameterDetail.tsx — 标量参数编辑

**编辑控件**（根据元数据类型自适应）：
- **Boolean**：大型切换开关
- **Discrete**：选项按钮网格
- **Numeric**：滑块 + 数字输入（带 min/max/unit）

**操作**：Save、Revert、Restore Default

**反馈**：
- `lastSetResult` 触发 CSS 发光动画（`param-glow-success/error/warning`）
- 状态 toast

**比较头部**：修改时显示 "Current Value → New Value"

---

## ParameterArrayDetail.tsx — 数组参数编辑

- 数组描述、默认值 pill、整体值比较

**元素列表**：
- 每个元素：索引标签、滑块/数字输入、待处理指示器、状态图标

**底部操作**：Save All、Revert All、Reset to Default

---

## MessageMonitor.tsx — 消息监控

**数据**：订阅 `workerBridge.onStats(stats)`
- 提供每种消息类型的最新值和频率

**显示**：
- 可折叠消息列表
- 展开后显示字段和实时值

**点击绘图**：
- 数值字段可点击
- 调用 `onFieldSelected(messageName, fieldName)`
- 活跃信号显示颜色左边框和着色背景

**格式化**：
- 枚举值通过注册表解析
- 特殊 `AUTOPILOT_VERSION` 格式化
- 单位转换

---

## StatusTextLog.tsx

- 可折叠底部面板
- 显示 `STATUSTEXT` 条目
- 严重级别颜色和标签
- 展开时自动滚动

---

## LogLibraryPane.tsx

- 可折叠头部（展开/折叠、刷新、批量删除）

**条目列表**：
- 点击加载/卸载
- Ctrl/Cmd+点击多选
- Shift+点击范围选择

**操作**：
- 重命名、导出、删除（通过溢出菜单）
- 批量删除模态框（选中/全部）

**状态**：使用 `useLogLibrary` hook

---

## DebugConsole.tsx

- 全局可折叠底部控制台
- 订阅 `onDebugConsoleEntry` / `onDebugConsoleClear`
- 按源和级别过滤
- 多行体在 `<pre>` 中渲染

---

## StatusBar.tsx

- 从 `selectStatusBarModel(appState, isSerialSupported())` 推导显示

**左侧**：
- 状态圆点 + 标题 + 徽章（用 `/` 分隔）

**右侧**：
- 详情（用细竖线分隔）

---

## SettingsModal.tsx — 设置模态框

**标签页**：

### General
- 主题切换
- UI 缩放滑块
- 单位配置选择
- 轨迹长度输入

### Serial
- 自动连接开关
- 自动波特率开关
- 波特率选择
- Forget All Ports

### MAVLink
- 导入方言 XML（多文件，解析 include）
- Reset to Default
- 方言 URL 输入（Save/Clear）
- 缓冲区容量输入

### Advanced
- 调试控制台开关
- 模拟器启动/停止

**底部**：应用版本 + 离线就绪指示器

---

## HelpOverlay.tsx

- 固定模态框
- 帮助章节：Modes、Plots、Charts、Map

---

## InstallPrompt.tsx

- 捕获 `beforeinstallprompt` 事件时显示 "Install App"
- 已安装 PWA 且 `updateAvailable` 为 true 时显示 "Update — Reload"

---

## TabBar.tsx

遗留简单标签栏（Telemetry/Map）。当前未使用（Toolbar 已有分段按钮）。

---

## hooks.ts

```typescript
function toggleSetItem<T>(setter: (fn: (prev: Set<T>) => Set<T>) => void, item: T): void
```

---

## 测试文件

| 测试文件 | 覆盖内容 |
|---------|---------|
| `DebugConsole.test.tsx` | 多行体渲染、源标签显示 |
| `SettingsModal.test.tsx` | 模拟器启动/停止/状态转换 |
| `StatusBar.test.tsx` | 实时会话芯片、日志回放上下文 |
| `Toolbar.test.tsx` | WebUSB 手动/自动连接按钮标签、授权状态 |

---

## UI 架构关键模式

1. **全局 Store**：`appState` 是模块级 `createStore`，非 Context-based，组件直接读取
2. **Service Context**：`RuntimeServicesProvider` 注入 workerBridge、connectionManager 等，Hooks 用 `useContext` 消费
3. **Worker Bridge 模式**：所有 MAVLink 数据通过 `MavlinkWorkerBridge`，UI 订阅 typed callbacks
4. **Gridstack 隔离**：Gridstack 拥有 widget DOM，SolidJS 挂载到 content div 内部
5. **模块级 Hook 状态**：`useParameters` 和 `expandedGroups` 使用模块级 `createSignal`，Tab 切换时状态保留
6. **双向暂停同步**：`isPaused` ↔ `interactionController` ↔ chart zoom ranges
7. **日志回放覆盖**：`logViewerState.isActive` 禁用串口控制、暂停 auto-connect、改变 chart/map 行为
