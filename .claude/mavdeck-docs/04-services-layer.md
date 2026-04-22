# 服务层详解（services/ 模块）

services/ 是项目最大的模块，约 45 个源文件 + 30+ 测试文件。分为以下几个子系统：

1. 字节源与串口抽象
2. MAVLink 数据流水线
3. Tlog 录制与回放
4. 参数系统
5. FTP 与元数据下载
6. 连接与会话管理
7. 工具与辅助服务

---

## 1. 字节源与串口抽象

### byte-source.ts
```typescript
interface IByteSource {
  onData: EventEmitter<(data: Uint8Array) => void>
  onError: EventEmitter<(err: Error) => void>
  connect(): Promise<void>
  disconnect(): Promise<void>
  write(data: Uint8Array): Promise<void>
  isConnected: boolean
}
```

### external-byte-source.ts
- 用于**主线程读取串口数据，转发到 Worker**
- `emitBytes(data)` 分发给回调
- `write()` 转发到回调（用于 WebUSB 写回）

### spoof-byte-source.ts — 软件模拟器
生成逼真遥测数据用于无硬件测试：
- **10Hz**：ATTITUDE（随机游走 roll/pitch）、GLOBAL_POSITION_INT（固定位置）、VFR_HUD
- **1Hz**：HEARTBEAT、SYS_STATUS、STATUSTEXT
- **模拟模型**：
  - 航向：figure-8 模式
  - 高度/横滚/俯仰：随机游走
  - 电池：缓慢消耗
- **回环响应器**：
  - `SpoofParamResponder`：解析发出的参数请求，返回模拟参数值
  - `SpoofFtpResponder`：解析 FTP 请求，返回模拟文件数据

### webserial-byte-source.ts
**主线程**原生 Web Serial 读取器：
- `connect(existingPort?)`：打开端口，启动 read loop
- `write()`：获取 writer，写入，释放锁

### worker-serial-byte-source.ts
**Worker 内**原生 Web Serial 读取器：
- `connect()`：打开端口，启动 `readLoop()`
- `detach()` / `suspend()` / `resumeAttached()`：**流水线重绕不换端口**
- **BreakError 恢复**：UART `BreakError` 被捕获为可恢复错误，重新获取 reader

### ftdi-serial-port.ts — Android WebUSB polyfill
为 FTDI FT232R 芯片实现 `PortLike` 接口：
- `computeBaudDivisor()`：编码波特率（3MHz 基准时钟 + 子整数分频查找表）
- 剥离每包 2 字节 modem status 前缀
- 验证单接口、vendor-class、bulk-IN/OUT 端点布局

### serial-backend.ts
后端路由器：
- 桌面 + Web Serial → `'native'`
- Android 或无 Web Serial → `'webusb'`
- `requestPort()` / `getGrantedPorts()` 分发到正确后端

### serial-probe-service.ts
探测串口上的 MAVLink 流量：
- `probeSinglePort()`：按优先级尝试波特率（上次成功优先，然后 `BAUD_PROBE_ORDER`）
- `startProbing()`：循环所有已授权端口，`AbortController` 取消
- 使用 `MavlinkDecodeVerifier`（完整 CRC + 解码验证），而非轻量 `MavlinkFrameDetector`
- 探测成功后关闭端口；实际连接时重新打开

### serial-port-identity.ts
- `getSerialPortIdentity()`：提取 `{usbVendorId, usbProductId, usbSerialNumber}`
- `matchesSerialPortIdentity()`：比较身份，无序列号时回退到 vendor/product

---

## 2. MAVLink 数据流水线

### mavlink-service.ts — 中央流水线
```
ByteSource → MavlinkFrameParser → MavlinkMessageDecoder
                                    ↓
                         ┌─────────┴─────────┐
                    MessageEmitter      PacketEmitter
                         ↓                     ↓
                   Tracker + TSManager     Tlog recorder
```

- `CONTROL_PLANE_MESSAGES`（PARAM_VALUE, FILE_TRANSFER_PROTOCOL 等）跳过 tracker/timeseries，避免污染遥测数据
- `attach()` / `detach()`：**流水线重绕不换底层源**

### message-tracker.ts
`GenericMessageTracker` 计算每条消息的统计信息：
- **5 秒滑动窗口**计算频率
- **衰减阶段**：2 秒无数据后频率在 3 秒内衰减到 0
- **过期清理**：10 秒无数据后移除条目
- 每 **100ms** 发送一次 stats 快照

### timeseries-manager.ts
`TimeSeriesDataManager` 存储数值遥测到环形缓冲区：
- 字段键格式：`"MESSAGE_NAME.field_name"` 或 `"MESSAGE_NAME.array_field[i]"`
- **跳过字符串字段**
- `processMessageWithTimestamp()` 支持批量日志回放
- 更新通知**60Hz 节流**
- `maxFields` 上限（默认 500），防止无限制增长

---

## 3. Tlog 录制与回放

### tlog-codec.ts
```typescript
function encodeTlogRecord(timestampUs: number, packet: Uint8Array): Uint8Array
// → 8 字节小端序 timestampUs + 原始 packet

function parseTlogBytes(data: Uint8Array): TlogRecord[]
// → 用 STX 字节 (0xFE/0xFD) 确定包长度，解析所有记录
```

### tlog-service.ts
主线程日志文件管理，使用 **OPFS + IndexedDB 暂存**：

**录制流程**：
1. `stageSessionStart()` / `stageSessionChunk()` / `finalizeSession()`
2. 块通过 `logChunk` 事件到达，暂存在 IndexedDB (`idb-keyval`)
3. 会话结束时，拼接所有块写入 OPFS 文件
4. `buildLogFileName()`：用时间戳和时长命名

**崩溃恢复**：
- `recoverStagedSessions()`：启动时恢复未完成的会话

**其他操作**：
- `listLogs()`, `readLogFile()`, `exportLogFile()`, `deleteLogFile()`, `setLogMetadata()`

### log-viewer-service.ts
日志回放编排：
- `load(records, sourceName)`：暂停实时串口，转换微秒到毫秒，调用 `bridge.loadLog()`
- `unload()`：调用 `bridge.unloadLog()`，恢复实时会话

---

## 4. 参数系统

### parameter-types.ts
```typescript
interface ParameterValue {
  name: string
  value: number
  type: number  // MAVLink parameter type enum
  index: number
  count: number
}

interface ParameterStateSnapshot {
  values: Map<string, ParameterValue>
  fetchStatus: ParamFetchStatus
}

interface ParamSetResult {
  name: string
  success: boolean
  requestedValue: number
  actualValue?: number
  error?: string
}
```

### parameter-manager.ts
Worker 端 MAVLink 参数协议状态机：

**requestAll()**：
1. 发送 `PARAM_REQUEST_LIST`
2. 收集 `PARAM_VALUE` 响应
3. **间隙填充定时器**：2s 间隔，最多 3 轮，请求缺失索引

**setValue()**：
1. 发送 `PARAM_SET`
2. 等待匹配的 `PARAM_VALUE`
3. 超时重试，最多 3 次
4. 容忍浮点比较 (`1e-6`)

**状态发射**：**10Hz 节流**

### param-metadata-service.ts
将平面 JSON 元数据文件解析为 `Map<string, ParamDef>`：
- 推断显示类型：
  - `Boolean`：Int32 且值为 {0,1}
  - `Discrete`：Int32 且有离散值列表
  - `Integer`：Int32
  - `Float`：Float32
- 数组参数自动检测：从 `shortDesc` 中的括号模式（如 `scaler.pitch_ff_vel_mps[0]`）

### parameter-display.ts
显示辅助：
- `getParameterDisplayName()`
- `formatValue()` — Boolean → ON/OFF，Discrete → 描述查找，数值 → `toFixed(decimalPlaces)`
- `isAtDefault()`

### parameter-grouping.ts
`buildParamGroups()`：
- 按元数据分组（或回退到前缀）
- 分离标量和数组
- 字母排序

---

## 5. FTP 与元数据下载

### ftp-types.ts
MAVLink FTP 子协议常量和编解码：
- 操作码：`OPEN_FILE_RO`, `READ_FILE`, `BURST_READ_FILE`, `TERMINATE_SESSION`, `ACK`, `NACK`...
- `encodeFtpPayload()` / `decodeFtpPayload()`：固定 251 字节布局

### ftp-client.ts
单文件下载状态机：

**首选模式：Burst Read**
- 自适应回退到 Sequential

**洞修复**：
- Burst EOF 后计算缺失块
- 用 `READ_FILE` 填补

**退化检测**：
- 如果服务器返回单块 burst + 超时
- 降级到 sequential 模式
- `preferredReadMode` 持久化：一旦 burst 被证明不支持，后续下载默认 sequential

**其他机制**：
- 序列号验证、会话匹配
- 重试：最多 3 次，1s 超时

### metadata-ftp-downloader.ts
两步元数据下载：
1. 下载 `/general.json`（组件元数据清单）
2. 解析 `mftp:///...` URI，下载元数据文件
3. 验证 CRC32
4. 如需则解压 `.xz`（使用 `XzReadableStream`）
5. 缓存到 IndexedDB（按 CRC 键值）

### metadata-cache.ts
IndexedDB 缓存 + 内存回退：
- 键：CRC32
- 值：元数据 JSON 字符串

---

## 6. 连接与会话管理

### worker-bridge.ts
`MavlinkWorkerBridge` — **主线程到 Worker 的 Facade**：
- 从 `mavlink-worker.ts` 创建 `Worker`
- 封装 `postMessage` 为类型化的 `WorkerCommand`
- 将 `WorkerEvent` 消息转换为 `EventEmitter` 回调
- **缓存最后一个 `update`**，新订阅者立即获得数据
- 向后兼容地重新导出协议类型

### connection-manager.ts
更简单的 UI facade：
- 本地跟踪 `_status`
- `connect()` 分发到 `bridge.connect()`（spoof/external）或 `bridge.connectSerial()`（串口）
- `startAutoConnect()` / `stopAutoConnect()` 委托给 bridge

### serial-session-controller.ts
**最复杂的主线程编排器**，处理 native 和 Android 两条路径：

**会话阶段**：`'idle'` → `'probing'` → `'connecting_serial'` → `'connected_serial'` → `'connected_serial_idle'` / `'error'`

**Native 路径**：
1. `navigator.serial.requestPort()`
2. 告诉 Worker `bridge.connectSerial()`

**Android 路径**：
1. `FtdiSerialPort` 在主线程创建
2. 字节转发到 Worker `bridge.sendBytes()`
3. Worker 的 `writeBytes` 事件 → 写回 FTDI 端口

**Auto-connect**：
- Native：委托 Worker `bridge.startAutoConnect()`
- Android：`syncAutoConnectWebUsb()` 轮询已授权 FTDI 端口

**日志回放暂停**：
- `suspendForLogPlayback()`：保存会话快照
- `resumeAfterLogPlayback()`：恢复会话

**WebUSB 可用状态**：
`'unknown'` → `'needs_grant'` → `'needs_regrant_android'` → `'waiting_for_device'` → `'granted'`

### session-state-sync.ts
将 `SerialSessionController` 事件绑定到 SolidJS App Store：
- 连接状态、探测状态、会话状态、串口信息、WebUSB 可用性
- 成功连接时调用 `persistSerialSettings()`

---

## 7. 工具与辅助服务

### mavlink-frame-detector.ts
**轻量、无注册表**的探测器，用于波特率探测：
- 扫描两个连续的格式正确 MAVLink 帧（v1 或 v2）
- 检查 STX 字节和长度预测边界
- **无 CRC 验证** — 为速度设计

### mavlink-decode-verifier.ts
**完整 CRC + 解码验证**，用于探测：
- `waitForDecodedPacket()`：基于 Promise，带超时和 abort signal
- 被 `SerialProbeService` 和 `SerialSessionController`（Android 路径）使用

### debug-console.ts
全局调试日志：
- 子系统源：`app`, `worker`, `serial`, `metadata-ftp`...
- 上限 400 条
- `logDebugInfo/Warn/Error()` 辅助函数

### status-text-log.ts
全局 `STATUSTEXT` 日志，上限 100 条

### settings-service.ts
IndexedDB 持久化设置：
- `loadSettings()`：与 `DEFAULT_SETTINGS` 合并（向前兼容）
- `saveSettingsDebounced()`：2 秒防抖
- `saveDialect` / `loadDialect`：方言 JSON 持久化

### dialect-loader.ts
MAVLink XML 方言加载：
- `loadBundledDialect()`：从 `public/dialects/` 获取 common.xml/standard.xml/minimal.xml，解析为 JSON
- `loadRemoteDialect()`：从远程 URL 获取，递归解析 `<include>`
- `detectMainDialect()`：找到不被任何 `<include>` 引用的根文件

### unit-display.ts
单位转换：
- 配置文件：`raw`, `metric`, `imperial`, `aviation`
- `formatDisplayValue()` 根据上下文（`monitor`, `plot`, `map`）格式化

### signal-metadata.ts
信号元数据辅助

### autopilot-version-format.ts
解码 `AUTOPILOT_VERSION` 消息字段：
- 打包软件版本整数 → 语义版本字符串（dev/alpha/beta/rc 后缀）
- 自定义版本字节数组 → ASCII git hash
- `uid`/`uid2` → 十六进制字符串

### layout-persistence.ts
绘图标签配置的序列化/反序列化

### runtime-services.tsx
SolidJS Context Provider：
- 暴露 `workerBridge`, `connectionManager`, `registry`, `logViewerService`, `serialSessionController`
- Hooks 通过 `useContext` 消费

### update-sw.ts
Service Worker 更新逻辑

### install-prompt.ts
PWA 安装提示逻辑（`beforeinstallprompt` 事件）

### baud-rates.ts
共享串口常量：
- 支持的波特率数组
- 默认波特率：500000
- 探测顺序
- Web Serial / WebUSB API 特性检测
- `PROBE_TIMEOUT_MS`

---

## 测试文件（services/ 测试）

| 测试文件 | 覆盖内容 |
|---------|---------|
| `autopilot-version-format.test.ts` | 版本解码、git hash、hex uid、null 返回 |
| `debug-console.test.ts` | 日志上限、级别过滤、清除 |
| `external-byte-source.test.ts` | 字节分发、写入回调 |
| `ftdi-serial-port.test.ts` | 波特率分频计算、modem status 剥离、端点验证 |
| `ftp-client.test.ts` | burst/sequential 下载、洞修复、退化检测、重试、超时 |
| `ftp-types.test.ts` | 编解码、操作码常量 |
| `layout-persistence.test.ts` | 序列化/反序列化 |
| `log-viewer-service.test.ts` | load/unload、暂停/恢复 |
| `mavlink-frame-detector.test.ts` | 帧检测、同步、无 CRC |
| `mavlink-service.test.ts` | Spoof 数据流、消息接收、attach/detach、回调取消订阅 |
| `message-tracker.test.ts` | 频率计算、衰减、过期清理 |
| `metadata-ftp-downloader.test.ts` | 两步下载、CRC 验证、解压、缓存 |
| `param-metadata-service.test.ts` | 类型推断、数组检测 |
| `parameter-manager.test.ts` | requestAll、gap-fill、setValue、重试、超时 |
| `serial-port-identity.test.ts` | 身份提取、匹配 |
| `serial-probe-service.test.ts` | 单端口探测、多端口循环、取消 |
| `serial-session-controller.test.ts` | 连接生命周期、auto-connect、WebUSB、日志暂停 |
| `settings-service.test.ts` | 加载、保存、防抖、方言持久化 |
| `spoof-byte-source.test.ts` | 模拟数据生成、回环响应 |
| `spoof-ftp-responder.test.ts` | FTP 响应模拟 |
| `spoof-param-responder.test.ts` | 参数响应模拟 |
| `status-text-log.test.ts` | 日志上限、条目添加 |
| `timeseries-manager.test.ts` | 字段键生成、环形缓冲区填充、60Hz 节流、maxFields |
| `tlog-codec.test.ts` | 编码/解码、空输入、边界情况 |
| `tlog-service.test.ts` | 暂存、finalize、崩溃恢复、列表/删除 |
| `unit-display.test.ts` | 单位转换、格式化 |
| `worker-serial-byte-source.test.ts` | 连接、断开、suspend/resume、BreakError |
