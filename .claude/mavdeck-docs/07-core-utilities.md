# 核心工具类（core/ + models/）

## core/ 模块

### ring-buffer.ts — 零 GC 环形缓冲区

**类**：`RingBuffer`

**用途**：时间序列数据的零 GC 存储，直接与 uPlot 兼容。

**存储布局**：Struct-of-arrays
```
timestamps:     Float64Array (循环存储，毫秒级)
values:         Float64Array (循环存储)
viewTimestamps: Float64Array (预分配的连续视图)
viewValues:     Float64Array (预分配的连续视图)
```

**API**：
```typescript
class RingBuffer {
  constructor(capacity?: number)  // 默认 2000

  push(timestampMs: number, value: number): void
    // 满时覆盖最旧数据

  toUplotData(): [Float64Array, Float64Array]
    // 返回 [timestampsInSeconds, values]
    // 毫秒 → 秒转换（/1000）
    // 处理环绕：两段复制到 view 缓冲区
    // 不分配新的 Float64Array

  getLatestValue(): number | undefined
  getLatestTimestamp(): number | undefined
  clear(): void
  get length(): number
  get capacity(): number
  get isFull(): boolean
}
```

**关键实现细节**：
- `toUplotData()` 返回的是 `viewTimestamps`/`viewValues` 的子数组（subarray），不是新分配的数组
- 同一底层 `ArrayBuffer`  across 多次调用
- 环绕处理：将两段不连续数据复制到预分配视图缓冲区，返回连续视图

**测试覆盖**：push、length、环绕排序、毫秒→秒转换、分配行为（同一 ArrayBuffer）、getLatestValue/Timestamp、clear、默认容量（2000）、边界情况（capacity=1、恰好 capacity 项）

---

### event-emitter.ts — 轻量类型化事件发射器

**类**：`EventEmitter<T>`

**用途**：替代手动 `Set<Callback>` 样板代码，提供类型安全的发布订阅。

**API**：
```typescript
class EventEmitter<T extends (...args: any[]) => void> {
  on(listener: T): () => void      // 返回取消订阅函数
  emit(...args: Parameters<T>): void
  clear(): void
  get size(): number
}
```

**实现**：
- 内部使用 `Set<T>`
- 监听器按插入顺序迭代
- `on()` 返回的取消订阅函数从 Set 中移除该监听器

**使用方**：
- `frame-parser.ts` — `onFrame`
- `plot-interactions.ts` — zoom/reset 广播
- 多个 byte source 实现 — `onData`/`onError`

**测试覆盖**：单/多监听器、参数传递、零参数事件、去重（同一引用只添加一次）、取消订阅、clear、size 跟踪

---

### crc32.ts — 标准 CRC32

**用途**：文件完整性检查（与 MAVLink CRC 不同）。

**算法**：标准 zlib/ISO 3309 CRC32

**导出**：
```typescript
function crc32(data: Uint8Array): number  // 返回无符号 32 位整数
```

**实现**：
- 模块加载时预计算 256 条目查找表（`TABLE`）
- 运行时查表计算，O(n)

**使用方**：
- `metadata-ftp-downloader.ts` — 验证下载的元数据文件 CRC

**测试覆盖**：空输入（`0x00000000`）、标准测试向量（"123456789" → `0xCBF43926`）、一致性、不同输入区分

---

### plot-interactions.ts — 图表交互同步

**导出**：
```typescript
function createPlotInteractionController(): PlotInteractionController

interface PlotInteractionController {
  emitZoom(sourcePlotId: string, range: ZoomRange): void
  emitReset(sourcePlotId: string): void
  subscribe(callback: (snapshot: PlotInteractionSnapshot) => void): () => void
  getSnapshot(): PlotInteractionSnapshot
}

interface PlotInteractionSnapshot {
  mode: 'live' | 'zoomed'
  zoomRange: ZoomRange | null
  lastSourcePlotId: string | null
}

interface ZoomRange {
  min: number
  max: number
}

type InteractionMode = 'live' | 'zoomed'
```

**行为**：
- `emitZoom` 和 `emitReset` 是幂等的：如果状态未变则 no-op
- 通过 `EventEmitter` 广播给所有订阅者
- `lastSourcePlotId` 跟踪最后一次交互的源图表

**使用方**：
- `TelemetryView.tsx` — 创建并传递给所有 `PlotChart`
- `PlotChart.tsx` — 滚轮缩放时 `emitZoom`，双击时 `emitReset`

**测试覆盖**：初始 live 模式、zoom/reset 转换、订阅/取消订阅、重复 zoom 范围去重、冗余 reset 去重、多订阅者、lastSourcePlotId 跟踪

---

### index.ts

Barrel 导出：`RingBuffer`, `EventEmitter`, `crc32`, `plot-interactions` 所有类型

---

## models/ 模块

### parameter-metadata.ts — 参数元数据类型

**导出**：
```typescript
interface ParamValueOption {
  value: number
  label: string
}

interface ParamDef {
  name: string
  displayName?: string
  group?: string
  shortDesc?: string
  longDesc?: string
  type: 'Float' | 'Boolean' | 'Discrete' | 'Integer'
  rebootRequired?: boolean
  defaultValue?: number
  min?: number
  max?: number
  units?: string
  decimalPlaces?: number
  values?: ParamValueOption[]
  array?: {
    prefix: string
    index: number
    count: number
  }
}
```

**用途**：
- `param-metadata-service.ts` 解析 JSON 后输出 `Map<string, ParamDef>`
- `ParametersView` 和子组件根据 `ParamDef` 渲染不同的编辑控件

---

### plot-config.ts — 绘图配置类型

**导出**：
```typescript
type ScalingMode = 'auto' | 'unified' | 'independent'
type TimeWindow = 5 | 10 | 30 | 60 | 120 | 300  // 秒

interface PlotSignalConfig {
  fieldKey: string      // "MESSAGE_NAME.field_name"
  color: string          // 规范颜色
  label?: string
}

interface PlotConfig {
  id: string
  signals: PlotSignalConfig[]
  scalingMode: ScalingMode
}

interface PlotTab {
  id: string
  name: string
  plots: PlotConfig[]
}

const SIGNAL_COLORS: string[]  // 暗色主题规范颜色数组
const DEFAULT_TIME_WINDOW = 30  // 秒

function getThemeColor(color: string, isLight: boolean): string
// 将规范颜色映射到亮色主题变体（通过 Map）
```

---

### index.ts

导出：
- `STATUS_COLORS` — `ConnectionStatus` → 十六进制颜色的映射
- `plot-config` 所有类型和常量
- `ParamDef` / `ParamValueOption`（来自 parameter-metadata）

---

## 设计模式总结

| 工具 | 模式 | 关键特性 |
|------|------|---------|
| `RingBuffer` | 预分配 + 环绕 | 零 GC，Float64Array 原生，uPlot 直接兼容 |
| `EventEmitter` | 类型化发布订阅 | 轻量，插入顺序，自动去重 |
| `crc32` | 查表法 | 模块级预计算 TABLE，O(n) |
| `PlotInteractionController` | 状态快照 + 幂等广播 | 避免重复 zoom/reset 事件 |

这些工具的共同特点是：**简单、专注、零依赖、高性能**。它们不依赖 SolidJS 或任何 UI 框架，是项目中可以跨场景复用的底层构建块。
