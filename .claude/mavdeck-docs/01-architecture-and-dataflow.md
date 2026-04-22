# 架构设计与完整数据流

## 核心架构决策

### 1. Web Worker 隔离
所有 MAVLink 解析、CRC 校验、解码、环形缓冲区写入都在 Worker 中进行。主线程只做渲染。
- 数据传输通过 `postMessage` + `Transferable ArrayBuffer` 实现零拷贝
- Worker 文件 (`mavlink-worker.ts`) 是薄壳，所有逻辑在 `WorkerController` 中

### 2. WorkerController 模式
Worker 状态机和命令分发全部封装在可测试的 `WorkerController` 类中。
- 测试时可以直接实例化 `WorkerController`，传入 mock `postEvent`
- 薄壳 `mavlink-worker.ts` 只负责 `postMessage`/`onmessage` 接线

### 3. 类型安全 Worker 协议
使用 discriminated union 实现类型安全的双向通信：
- `WorkerCommand`（17+ 种命令，主线程 → Worker）
- `WorkerEvent`（20+ 种事件，Worker → 主线程）
- 定义在 `src/workers/worker-protocol.ts`

### 4. Float64Array 环形缓冲区
- 时间序列数据存储为 `[timestamps, values]` 结构
- 预分配固定容量，永不增长，零 GC
- 直接与 uPlot 兼容

### 5. 兴趣字段优化
Worker 只向 UI 推送当前需要显示的字段数据，减少主线程压力。
- 由 `use-interested-fields.ts` 钩子收集所有可见信号
- 通过 `workerBridge.setInterestedFields()` 传递给 Worker

### 6. Gridstack + SolidJS 隔离
Gridstack 直接操作 DOM 进行布局，与 SolidJS 的虚拟 DOM 冲突。
- 解决方案：Gridstack 创建 `grid-stack-item` DOM 节点，SolidJS 用 `render()` 挂载到 `grid-stack-item-content` 内部
- 清理时用 `dispose()` 卸载 SolidJS 根，再用 `grid.removeWidget()` 移除节点

## 完整数据流

### 实时串口连接（桌面端）

```
用户点击 Connect
  → SerialSessionController.connectManual()
    → navigator.serial.requestPort()
      → ConnectionManager.connect()
        → bridge.connectSerial()        [主线程]
          → WorkerController.handleCommand('connectSerial')  [Worker]
            → 创建 WorkerSerialByteSource
              → 打开串口，启动 readLoop()
                → 字节流入 MavlinkService
                  → MavlinkFrameParser（帧解析）
                    → MavlinkMessageDecoder（解码）
                      → 分流：
                        ├→ GenericMessageTracker（统计，100ms 间隔）
                        ├→ TimeSeriesDataManager（环形缓冲区，60Hz 节流）
                        ├→ ParameterManager（参数协议）
                        ├→ MetadataFtpDownloader（FTP 元数据下载）
                        └→ forwardStatusText()（STATUSTEXT 组装）
                      → postUpdate / postStats / postParamState 等
                        → MavlinkWorkerBridge.onmessage  [主线程]
                          → EventEmitter 回调分发
                            → UI 组件订阅并更新
```

### 实时串口连接（Android / WebUSB）

```
SerialSessionController 检测到 'webusb' 后端
  → 创建 FtdiSerialPort（主线程）
    → WebSerialByteSource 读取字节
      → bridge.sendBytes() 转发到 Worker
        → Worker 使用 ExternalByteSource 接收
          → 后续流水线与桌面端相同
    → Worker 的 writeBytes 事件 → 主线程 write-back → FTDI 端口
```

### Tlog 录制流程

```
MavlinkService.onPacket() 发出原始包 + timestampUs
  → appendPacketToLog() 编码并累积块
    → 触发条件：块大小 >= 256KB 或定时器 1s
      → postMessage('logChunk', ArrayBuffer transfer)
        → 主线程 tlog-service.ts stageSessionChunk() → IndexedDB 暂存
          → onLogSessionEnd → finalizeSession() → OPFS 文件写入
```

### Tlog 回放流程

```
用户选择日志文件
  → parseTlogBytes() 提取 {timestampUs, packet}[]
    → LogViewerService.load()
      → 暂停实时串口会话（suspendForLogPlayback）
      → bridge.loadLog()
        → Worker batchProcessPackets() 同步解析所有包
          → TimeSeriesDataManager 用原始时间戳填充环形缓冲区
            → postMessage('loadComplete')
              → UI 切换到日志模式
                → unload() → 恢复实时会话
```

### Spoof / 模拟器模式

```
ConnectionManager.connect({ type: 'spoof' })
  → SpoofByteSource 在 Worker 中定时生成帧
    → 包含 10Hz 遥测（ATTITUDE, GLOBAL_POSITION_INT, VFR_HUD）
    → 包含 1Hz 遥测（HEARTBEAT, SYS_STATUS, STATUSTEXT）
    → 包含回环响应器：SpoofParamResponder + SpoofFtpResponder
      → 解析发出的 PARAM_REQUEST_LIST 等，返回模拟响应
```

## 模块间依赖关系

```
xml-parser.ts ──生成 JSON──→ registry.ts ──元数据──→ frame-parser.ts
                                              ↓
                                        decoder.ts
                                              ↓
                                        frame-builder.ts
                                              ↑
                                        crc.ts (共享)

ring-buffer.ts ←──时间序列数据── timeseries-manager.ts
plot-interactions.ts ←──图表联动── PlotChart.tsx
event-emitter.ts ←──通用发布订阅── 多个模块

crc32.ts (独立，用于文件完整性，非 MAVLink CRC)
```

## 关键状态机

### SerialSessionController 会话阶段
- `'idle'` → `'probing'` → `'connecting_serial'` → `'connected_serial'` → `'connected_serial_idle'`
- 分支：`'connected_spoof'`（模拟器）、`'error'`

### WorkerController 处理三种数据源
1. `SpoofByteSource` — 软件模拟
2. `ExternalByteSource` — 主线程转发（Android WebUSB）
3. `WorkerSerialByteSource` — Worker 直接控制串口（桌面 Web Serial）

### ParameterManager 参数协议状态
- `PARAM_REQUEST_LIST` → 等待所有 `PARAM_VALUE`
- 间隙填充定时器：2s 间隔，最多 3 轮
- `PARAM_SET` → 等待匹配的 `PARAM_VALUE`，超时重试 3 次

### FtpClient 下载状态机
- 首选 burst read 模式
- 退化检测：如果服务器返回单块 burst + 超时，降级到 sequential
- 洞修复：burst EOF 后计算缺失块并用 READ_FILE 填补
- 重试：最多 3 次，1s 超时

## 性能约束（来自 CLAUDE.md）

- **预分配**：热路径中不得动态增长数组，使用固定容量 Float64Array
- **零拷贝**：Worker ↔ 主线程 使用 Transferable ArrayBuffer
- **批量更新**：UI 更新节流至 60Hz，在动画帧上刷新
- **无 GC 压力**：帧解析器/解码器内循环中禁止创建对象
- **禁止在数据处理循环中调用渲染函数**
