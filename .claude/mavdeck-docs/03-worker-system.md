# Web Worker 基础设施（workers/ 模块）

## 文件列表

| 文件 | 职责 |
|------|------|
| `src/workers/worker-protocol.ts` | 类型安全的 Worker 通信协议（ discriminated unions） |
| `src/workers/worker-controller.ts` | Worker 内核心状态机，所有逻辑在此 |
| `src/workers/mavlink-worker.ts` | Worker 薄壳，仅接线 postMessage/onmessage |
| `src/workers/mavlink-worker-pipeline-helpers.ts` | 流水线辅助函数（更新推送、STATUSTEXT 组装等） |
| `src/workers/mavlink-worker-log.ts` | Worker 内 Tlog 会话分块管理 |
| `src/workers/throughput-monitor.ts` | 1Hz 字节吞吐量测量 |
| `src/workers/data-activity-monitor.ts` | 串口空闲超时检测与恢复 |

---

## worker-protocol.ts — 类型安全协议

这是 Worker 和主线程之间的**唯一通信契约**。

### WorkerCommand（主线程 → Worker，17+ 种）

```typescript
type WorkerCommand =
  | { type: 'init'; payload: { dialectJson: string; bufferCapacity: number } }
  | { type: 'connect'; payload: { type: 'spoof' | 'external' } }
  | { type: 'disconnect' }
  | { type: 'bytes'; payload: { data: Uint8Array } }
  | { type: 'connectSerial'; payload: { baudRate: number } }
  | { type: 'startAutoConnect' }
  | { type: 'stopAutoConnect' }
  | { type: 'loadLog'; payload: { records: TlogRecord[] } }
  | { type: 'unloadLog' }
  | { type: 'setInterestedFields'; payload: { fields: string[] } }
  | { type: 'setBufferCapacity'; payload: { capacity: number } }
  | { type: 'paramRequestAll' }
  | { type: 'paramSet'; payload: { name: string; value: number } }
  | { type: 'ftpDownloadMetadata' }
  | { type: 'sendMavlinkMessage'; payload: { name: string; fields: Record<string, unknown> } }
  | { type: 'suspendLiveForLog' }
  | { type: 'resumeSuspendedLive' }
  | { type: 'clearMainThreadTelemetryState' }
```

### WorkerEvent（Worker → 主线程，20+ 种）

```typescript
type WorkerEvent =
  | { type: 'ready' }
  | { type: 'statusChange'; payload: { status: ConnectionStatus } }
  | { type: 'stats'; payload: MessageStatsSnapshot }
  | { type: 'update'; payload: UpdatePayload }  // Transferable Float64Array
  | { type: 'availableFields'; payload: { fields: string[] } }
  | { type: 'statustext'; payload: StatusTextEntry }
  | { type: 'logChunk'; payload: { sessionId: string; chunk: ArrayBuffer } }
  | { type: 'logSessionStart'; payload: { sessionId: string } }
  | { type: 'logSessionEnd'; payload: { sessionId: string } }
  | { type: 'paramState'; payload: ParamStateSnapshot }
  | { type: 'paramSetResult'; payload: ParamSetResult }
  | { type: 'ftpMetadataResult'; payload: FtpMetadataResult }
  | { type: 'throughput'; payload: { bytesPerSec: number } }
  | { type: 'activityIdle' }
  | { type: 'activityResumed' }
  | { type: 'writeBytes'; payload: { data: Uint8Array } }  // Android WebUSB 写回
  | { type: 'loadComplete'; payload: { durationSec: number; recordCount: number } }
  | { type: 'debugConsole'; payload: DebugConsoleEntry }
  | { type: 'error'; payload: { message: string } }
```

**设计要点**：
- 所有 payload 必须可结构化克隆（无 DOM 对象、无函数）
- `update` 和 `logChunk` 使用 `Transferable` 转移 `ArrayBuffer` 所有权
-  exhaustive switch 处理，无需 `as` 类型断言

---

## worker-controller.ts — 核心状态机

**类**：`WorkerController`

**设计原则**：所有 Worker 状态和逻辑在此类中，可脱离真实 Worker 环境测试（传入 mock `postEvent`）。

### 构造函数参数
```typescript
constructor(options: {
  postEvent: (event: WorkerEvent, transfer?: Transferable[]) => void
  throughputMonitor?: ThroughputMonitor
  dataActivityMonitor?: DataActivityMonitor
})
```

### 内部状态对象

#### PipelineState
持有 MAVLink 数据流水线的所有对象：
```typescript
interface PipelineState {
  service: MavlinkService
  frameParser: MavlinkFrameParser
  decoder: MavlinkMessageDecoder
  tracker: GenericMessageTracker
  timeseriesManager: TimeSeriesDataManager
  parameterManager: ParameterManager
  metadataDownloader: MetadataFtpDownloader
  // 各种订阅取消函数
}
```

#### SerialState
```typescript
interface SerialState {
  byteSource: WorkerSerialByteSource
  probeService: SerialProbeService
  autoConnectConfig: AutoConnectConfig
  reconnectTimer: ReturnType<typeof setTimeout> | null
  logGraceTimer: ReturnType<typeof setTimeout> | null
}
```

#### LogState（由 mavlink-worker-log.ts 管理）

### 核心方法：handleCommand

```typescript
async handleCommand(command: WorkerCommand): Promise<void>
```

**命令处理映射**：

| 命令 | 处理逻辑 |
|------|---------|
| `init` | 创建 Registry，初始化 Decoder、FrameParser |
| `connect` (spoof) | 创建 SpoofByteSource，启动流水线 |
| `connect` (external) | 创建 ExternalByteSource，等待主线程发 bytes |
| `connectSerial` | 创建 WorkerSerialByteSource，打开串口 |
| `disconnect` | 断开所有源，清理 PipelineState |
| `bytes` | 将字节喂给 ExternalByteSource |
| `startAutoConnect` | 启动串口自动发现和连接 |
| `stopAutoConnect` | 停止自动连接 |
| `loadLog` | 暂停实时，批量处理 tlog 记录 |
| `unloadLog` | 清空时序数据，恢复实时（如被暂停）|
| `setInterestedFields` | 同步到 TimeSeriesDataManager |
| `setBufferCapacity` | 重新创建环形缓冲区（不丢端口）|
| `paramRequestAll` | 委托给 ParameterManager |
| `paramSet` | 委托给 ParameterManager |
| `ftpDownloadMetadata` | 委托给 MetadataFtpDownloader |
| `sendMavlinkMessage` | 用 FrameBuilder 编码，通过 ByteSource.write 发送 |
| `suspendLiveForLog` | 暂停实时串口，保留端口 |
| `resumeSuspendedLive` | 恢复之前暂停的实时会话 |
| `clearMainThreadTelemetryState` | 清空字段签名，发送空 stats/update |

### setupService() — 流水线接线

创建 `MavlinkService` 后，订阅所有输出：
1. **stats** → `GenericMessageTracker` → `postEvent('stats')`（100ms 间隔）
2. **timeseries** → `TimeSeriesDataManager` → `postUpdateFromManager()`（60Hz 节流）
3. **statustext** → `forwardStatusText()`（MAVLink 2 长文本组装）
4. **vehicle tracking** → 从 HEARTBEAT 识别飞行器身份
5. **packet logging** → `appendPacketToLog()`（Tlog 录制）
6. **parameters** → `ParameterManager` → `postEvent('paramState')`（10Hz 节流）
7. **FTP** → `MetadataFtpDownloader` → `postEvent('ftpMetadataResult')`

### sendMavlinkMessage()

使用 GCS 系统 ID **255**、组件 ID **190**（`MAV_COMP_ID_MISSIONPLANNER`）构建并发送 MAVLink 消息。

### reconnectWithCurrentSource()

在不关闭底层串口的情况下，改变缓冲区容量并重建流水线。用于 `setBufferCapacity` 命令。

---

## mavlink-worker.ts — Worker 薄壳

```typescript
// ~28 行
const controller = new WorkerController({
  postEvent: (event, transfer) => {
    if (transfer && transfer.length > 0) {
      self.postMessage(event, { transfer })
    } else {
      self.postMessage(event)
    }
  }
})

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  controller.handleCommand(e.data)
}
```

**为什么这样设计**：
- Worker 全局 `self` 无法在不启动 Worker 的情况下测试
- `WorkerController` 可以独立实例化测试
- 薄壳只负责消息路由，无逻辑

---

## mavlink-worker-pipeline-helpers.ts — 流水线辅助

### postUpdateFromManager()
从 `TimeSeriesDataManager` 提取感兴趣字段的环形缓冲区数据，转换为 `Float64Array` 对，通过 `Transferable` 转移所有权发送到主线程。

### forwardStatusText()
重组 MAVLink 2 的 chunked `STATUSTEXT` 长文本消息。
- 使用 `Map<key, PartialStatusText>` 状态跟踪未完成的消息
- 当所有 chunk 到达后，合并为完整文本并发送

### batchProcessPackets()
同步处理 tlog 回放的所有包。用于 `loadLog` 命令。

### serializeStats()
将 `Map<string, MessageStats>` 转为普通对象（用于 structured clone）。

### clearMainThreadTelemetryState()
清空字段签名，发送空的 stats 和 update，让 UI 重置。

---

## mavlink-worker-log.ts — Tlog 录制

### LogState
```typescript
interface LogState {
  sessionId: string
  startTimeUs: number
  chunks: Uint8Array[]
  totalBytes: number
  sequence: number
  flushTimer: ReturnType<typeof setTimeout> | null
}
```

### 关键常量
- `LOG_FLUSH_BYTES = 256 * 1024` — 块大小阈值
- `LOG_FLUSH_INTERVAL_MS = 1000` — 刷新定时器间隔

### 流程
1. `appendPacketToLog(timestampUs, packet)`：
   - 无活跃会话则自动创建
   - 用 `encodeTlogRecord()` 编码每条记录（8 字节时间戳 + 原始包）
   - 累积到 `chunks`
2. 触发 flush 条件：
   - 累积字节 >= 256KB
   - 或 1 秒定时器到期
3. `flushPendingLogChunk()`：
   - 合并 chunks 为单个 ArrayBuffer
   - `postEvent('logChunk', { sessionId, chunk }, [chunk])` — Transferable
   - 清空本地 chunks
4. `stopLogSession()`：
   - 刷新剩余数据
   - 发送 `logSessionEnd`

---

## throughput-monitor.ts — 吞吐量监控

```typescript
class ThroughputMonitor {
  start(source: DataSource): void
  stop(): void  // 发送 0 清除 UI
}
```

- 订阅 `onData`，累加字节数
- 每 1000ms 计算 `bytesPerSec`，发送 `throughput` 事件

---

## data-activity-monitor.ts — 活动监控

```typescript
class DataActivityMonitor {
  resetTimer(): void
  recordActivity(): void
}
```

- `resetTimer()` 启动 30 秒倒计时
- `recordActivity()` 重置计时器，如之前为 idle 则发送 `activityResumed`
- 超时时发送 `activityIdle`，连接状态变为 `'no_data'`

---

## 测试文件

| 测试文件 | 覆盖内容 |
|---------|---------|
| `worker-controller.test.ts` | 命令处理、状态转换、mock postEvent、init/connect/disconnect |
| `worker-controller-serial.test.ts` | 串口连接、波特率、断开重连、auto-connect 逻辑 |
| `throughput-monitor.test.ts` | 字节累加、1Hz 计算、stop 发送 0 |
| `data-activity-monitor.test.ts` | 超时检测、恢复检测、计时器重置 |
| `mavlink-worker-log.test.ts` | 会话创建、块累积、flush 阈值、定时器触发、session end |
| `mavlink-worker-pipeline-helpers.test.ts` | postUpdate、STATUSTEXT 组装、batchProcess、clearState |

---

## Worker 数据流总图

```
┌─ WorkerController ──────────────────────────────────────────────┐
│                                                                 │
│  ByteSource (Spoof/External/WorkerSerial)                       │
│    ├─ ThroughputMonitor → throughput events (1Hz)              │
│    └─ MavlinkFrameParser → MavlinkMessageDecoder               │
│                              ↓                                  │
│              ┌───────────────┼───────────────┐                 │
│              ↓               ↓               ↓                  │
│        MessageEmitter   PacketEmitter    ControlPlane          │
│              ↓               ↓               ↓                  │
│    GenericMessageTracker  TlogEncoder   ParameterManager       │
│    TimeSeriesDataManager              MetadataFtpDownloader    │
│              ↓                                                  │
│         postUpdate()        postStats()    postParamState()    │
│                                                                 │
│  DataActivityMonitor → idle/resume events (30s timeout)        │
│                                                                 │
└──────────────────────────┬────────────────────────────────────┘
                           │ postMessage (Transferable)
                           ↓
┌─ Main Thread ───────────────────────────────────────────────────┐
│                                                                 │
│  MavlinkWorkerBridge → onUpdate / onStats / onParamState ...   │
│              ↓                                                  │
│         AppStore (SolidJS createStore)                         │
│              ↓                                                  │
│    ├─ MessageMonitor (遥测列表)                                │
│    ├─ PlotChart (uPlot 图表)                                   │
│    ├─ MapView (Leaflet 地图)                                   │
│    ├─ ParametersView (参数面板)                                │
│    └─ StatusBar / StatusTextLog (状态栏/文本日志)              │
│                                                                 │
│  TlogService → IndexedDB staging → OPFS final                  │
│  LogViewerService → tlog 回放控制                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
