# MavDeck vs QGroundControl 功能对比分析

## 分析前提

- **MavDeck**：Web 原生 PWA，TypeScript/SolidJS，MAVLink 遥测可视化工具
- **QGroundControl**：桌面/Qt+QML 应用，C++，全功能 GCS
- **目标**：在 MavDeck 的 Web 技术栈中，逐步实现 QGC 的核心功能
- **QGC 源码位置**：`/Users/zhengguo/Desktop/taiyi/重构/MavDeck/qgroundcontrol-master`

---

## QGC 的四大主视图

QGC 的核心导航围绕四个视图展开（`MainWindow.qml` 中的 `SelectViewDropdown`）：

| 视图 | 目录 | 核心功能 |
|------|------|---------|
| **Fly** | `src/FlyView/` | 实时监控、地图/视频、仪表、控制操作 |
| **Plan** | `src/PlanView/` | 任务规划、Waypoint 编辑、Geofence、Rally Point |
| **Configure** | `src/AutoPilotPlugins/` + `src/Vehicle/VehicleSetup/` | 飞行器配置、传感器校准、参数、调参 |
| **Analyze** | `src/AnalyzeView/` | MAVLink 检查器、日志下载、控制台 |

---

## 详细功能对比表

### 1. 连接与通信

| 功能 | MavDeck | QGC | 差距分析 |
|------|---------|-----|---------|
| Web Serial 连接 | ✅ 完整支持（原生 + Android WebUSB/FTDI） | ❌ 不支持（桌面串口/TCP/UDP/蓝牙）| MavDeck 占优 |
| TCP/UDP 连接 | ❌ 不支持 | ✅ 完整支持 | QGC 有，但 Web Serial 对地面站更实用 |
| 自动波特率探测 | ✅ 完整（`SerialProbeService`） | ✅ 有 | 平手 |
| 自动连接 | ✅ 完整（native + WebUSB） | ✅ 有 | 平手 |
| 多机管理 | ❌ 单飞行器 | ✅ `MultiVehicleManager` | 较大差距 |
| 连接状态显示 | ✅ 基础（状态栏） | ✅ 详细（工具栏指示器）| QGC 更细致 |
| 日志录制（Tlog） | ✅ 完整（OPFS + IndexedDB） | ✅ 有 | MavDeck 的 Web 存储方案有特色 |
| 日志回放 | ✅ 完整 | ✅ 有 | 平手 |

### 2. Fly View — 实时监控

| 功能 | MavDeck | QGC | 差距分析 |
|------|---------|-----|---------|
| 地图显示 | ✅ Leaflet + OSM（3 种图层） | ✅ 自定义地图插件 | 平手，MavDeck 够用 |
| 飞行器轨迹 | ✅ 实时轨迹 + 日志回放轨迹 | ✅ 有 | 平手 |
| 飞行器标记 | ✅ 自定义 SVG 箭头（按航向旋转） | ✅ 更丰富的图标 | MavDeck 够用 |
| 视频流 | ❌ 不支持 | ✅ GStreamer/QtMultimedia/UVC | QGC 有，Web 端可用 WebRTC 替代 |
| 3D 视图 | ❌ 不支持 | ✅ `Viewer3D` 地形/飞行器可视化 | 较大差距，可选功能 |
| **姿态仪表** | ❌ **不支持** | ✅ `QGCAttitudeWidget` 人工地平线 + 罗盘 | **大差距** |
| 虚拟摇杆 | ❌ 不支持 | ✅ 双拇指摇杆 | 可选功能 |
| **综合状态面板** | ❌ **仅状态栏** | ✅ 工具栏：电池/GPS/链路/模式/健康 | **大差距** |
| 遥测数值显示 | ✅ `MessageMonitor`（消息级） | ✅ 可配置遥测值网格 | MavDeck 粒度较粗 |
| 告警/警告 | ✅ `StatusTextLog`（文本级） | ✅ 视觉覆盖层 + 健康检查报告 | 差距较大 |
| **预飞检查清单** | ❌ **不支持** | ✅ 多机型（多旋翼/固定翼/VTOL/无人车/潜艇）| **大差距** |
| **控制操作按钮** | ❌ **不支持** | ✅ 工具条：Arm/Disarm/Takeoff/Land/RTL... | **大差距** |
| **Guided 模式** | ❌ **不支持** | ✅ Goto/Land/RTL/ChangeAltitude/Orbit | **大差距** |
| 障碍物避让显示 | ❌ 不支持 | ✅ `ObstacleDistanceOverlay` | 可选 |
| 接近雷达 | ❌ 不支持 | ✅ `ProximityRadar` | 可选 |
| 多机列表 | ❌ 不支持 | ✅ 右上角多机选择器 | 可选 |

### 3. Plan View — 任务规划

| 功能 | MavDeck | QGC | 差距分析 |
|------|---------|-----|---------|
| Waypoint 编辑 | ❌ **不支持** | ✅ 点击地图添加、拖拽调整 | **大差距** |
| Mission 上传/下载 | ❌ **不支持** | ✅ `PlanManager` 完整协议 v2 | **大差距** |
| Mission 列表 | ❌ **不支持** | ✅ `PlanTreeView` 层级列表 | **大差距** |
| Mission 项类型 | ❌ **不支持** | ✅ Takeoff/Waypoint/RTL/Land/Loiter/Survey... | **大差距** |
| Geofence | ❌ **不支持** | ✅ `GeoFenceEditor` | **大差距** |
| Rally Point | ❌ **不支持** | ✅ `RallyPointEditor` | **大差距** |
| 地形感知 | ❌ **不支持** | ✅ `TerrainProgress` + 高度规划 | 可选 |
| KML/SHP 导入 | ❌ **不支持** | ✅ 支持 | 可选 |
| Mission 保存/加载 | ❌ **不支持** | ✅ 本地文件 | 可选 |

### 4. Configure — 飞行器配置

| 功能 | MavDeck | QGC | 差距分析 |
|------|---------|-----|---------|
| 参数读写 | ✅ 完整（列表、搜索、分组） | ✅ 更完善（批量、缓存、重映射）| QGC 更成熟 |
| 参数元数据 | ✅ 支持（JSON 加载） | ✅ `FactSystem` + 元数据驱动 UI | QGC 更完善 |
| 参数缓存 | ❌ 不支持 | ✅ PX4 hash-check 缓存 | 中等差距 |
| 机架选择 | ❌ 不支持 | ✅ `PX4/AirframeComponent` | 可选 |
| 传感器校准 | ❌ 不支持 | ✅ 罗盘/加速度计/陀螺仪/水平 | 可选 |
| 遥控器校准 | ❌ 不支持 | ✅ `RadioComponent` | 可选 |
| 飞行模式配置 | ❌ 不支持 | ✅ `PX4/FlightModesComponent` | 可选 |
| PID 调参 | ❌ 不支持 | ✅ `PX4/TuningComponent` | 可选 |
| 电池/电源设置 | ❌ 不支持 | ✅ `PX4/PowerComponent` | 可选 |
| 安全/故障保护 | ❌ 不支持 | ✅ `PX4/SafetyComponent` | 可选 |
| 相机/云台配置 | ❌ 不支持 | ✅ `CameraComponent` + `Gimbal` | 可选 |
| 电机测试 | ❌ 不支持 | ✅ `MotorComponent` | 可选 |

### 5. Analyze — 分析工具

| 功能 | MavDeck | QGC | 差距分析 |
|------|---------|-----|---------|
| MAVLink 检查器 | ❌ 不支持 | ✅ `MAVLinkInspector` | 可选 |
| MAVLink 控制台 | ❌ 不支持 | ✅ `MAVLinkConsole` | 可选 |
| 机载日志下载 | ❌ 不支持 | ✅ `OnboardLogs` | 可选 |
| 地理标记照片 | ❌ 不支持 | ✅ `GeoTag` | 可选 |
| 振动分析 | ❌ 不支持 | ✅ `Vibration` | 可选 |
| 调试控制台 | ✅ `DebugConsole.tsx` | ✅ 有 | MavDeck 有基础版 |

### 6. 底层能力

| 功能 | MavDeck | QGC | 差距分析 |
|------|---------|-----|---------|
| MAVLink 协议栈 | ✅ 完整（解析/编码/CRC/注册表） | ✅ 完整 | 平手 |
| 动态方言加载 | ✅ XML 运行时解析 | ❌ 静态链接 | MavDeck 占优 |
| 消息频率统计 | ✅ `MessageTracker`（5s 滑动窗口） | ✅ 有 | 平手 |
| 时间序列图表 | ✅ uPlot（高性能，联动缩放） | ✅ 有 | MavDeck 的图表性能优秀 |
| 参数协议 | ✅ 请求列表 + 间隙填充 | ✅ 更完善（FTP fallback、缓存）| QGC 更成熟 |
| Mission 协议 | ❌ 不支持 | ✅ 完整 v2 | 大差距 |
| FTP 协议 | ✅ 单文件下载（burst + sequential） | ✅ 更完善 | 平手 |
| 固件插件抽象 | ❌ 不支持 | ✅ `FirmwarePlugin` 分层 | 架构差距 |
| 状态机 | ❌ 简单 Promise/回调 | ✅ `QGCStateMachine` | 中等差距 |
| 主题/外观 | ✅ Light/Dark | ✅ 更丰富的自定义 | MavDeck 够用 |
| 单位系统 | ✅ raw/metric/imperial/aviation | ✅ 有 | 平手 |

---

## 差距分级

### 🔴 核心差距（必须补齐）

这些功能是地面站的"最低可用标准"，没有它们 MavDeck 始终只是一个遥测看板：

1. **Arm/Disarm 操作** — 最基本的安全控制
2. **飞行模式切换** — Manual/PosCtl/Auto/RTL/Hold 等
3. **综合状态显示** — 电池/GPS/链路/模式/健康的直观面板
4. **Guided 模式操作** — Takeoff/Land/RTL/Goto
5. **Mission 规划** — Waypoint 编辑、上传/下载
6. **预飞检查** — 安全检查清单

### 🟡 重要差距（强烈建议补齐）

7. **姿态仪表** — 人工地平线、罗盘
8. **Mission 项扩展** — Geofence、Rally Point
9. **参数缓存** — 减少每次全量下载
10. **告警系统** — 视觉告警覆盖层（不仅是文本日志）
11. **机架/传感器配置向导** — Setup 页面的核心

### 🟢 可选差距（后续视需求）

12. 视频流（WebRTC）
13. 3D 视图
14. 虚拟摇杆
15. 多机管理
16. MAVLink 检查器/控制台
17. 机载日志下载
18. 地形感知
19. KML/SHP 导入
20. 振动分析

---

## QGC 的关键架构模式（可借鉴到 MavDeck）

### 1. FirmwarePlugin 抽象层
QGC 将所有固件差异隔离在 `FirmwarePlugin` 子类中：
- `PX4FirmwarePlugin.cc` — PX4 模式映射、引导动作
- `ArduCopterFirmwarePlugin.cc` — ArduPilot 多旋翼
- `ArduPlaneFirmwarePlugin.cc` — ArduPilot 固定翼

**MavDeck 建议**：创建 `src/autopilot/` 模块，定义 `AutopilotAdapter` 接口，PX4 和 ArduPilot 分别实现。

### 2. FactSystem 参数元数据驱动 UI
QGC 中每个参数都是 `Fact` 对象，带有类型/范围/单位/枚举值元数据，UI 自动生成滑块/开关/下拉框。

**MavDeck 现状**：`param-metadata-service.ts` 已有基础，但不够完善。需要扩展元数据格式和 UI 自适应能力。

### 3. 状态机驱动的可靠通信
QGC 使用 `QGCStateMachine` 管理参数写入、Mission 传输等状态协议，带重试和超时。

**MavDeck 现状**：`ParameterManager` 已有简单的 gap-fill 和重试，但缺少通用状态机框架。

### 4. 健康与武装检查报告
QGC 解析 MAVLink `libevents` 健康检查事件，分类为 error/warning/info，决定 `canArm`/`canTakeoff`。

**MavDeck 现状**：无此能力，需要新增。

---

## MavDeck 现有的可复用资产（最大化利用）

| 资产 | 路径 | 复用场景 |
|------|------|---------|
| MAVLink 完整引擎 | `src/mavlink/` | 所有消息编解码 |
| Worker 基础设施 | `src/workers/` | 命令发送、数据流 |
| 发送能力 | `WorkerController.sendMavlinkMessage()` | Arm/Disarm/模式切换/Mission |
| 串口连接 | `src/services/serial-*.ts` | 无需改动 |
| 参数系统 | `src/services/parameter-*.ts` | 扩展元数据即可 |
| 地图 | `src/components/MapView.tsx` | Mission 规划的基础 |
| 图表 | `src/components/PlotChart.tsx` | 遥测显示 |
| 消息监控 | `src/components/MessageMonitor.tsx` | MAVLink 检查器的基础 |
| 状态管理 | `src/store/app-store.ts` | 新增状态字段 |
| 测试体系 | `__tests__/` | 新增功能测试 |

---

## 二次开发优先级建议

基于"最低可用 GCS"原则，建议按以下优先级：

### P0 — 核心闭环（先做这些才能叫地面站）
1. **综合状态面板**（电池/GPS/链路/模式/健康）
2. **Arm/Disarm 按钮**
3. **飞行模式切换**
4. **基础 Guided 操作**（Takeoff/Land/RTL）

### P1 — 任务规划
5. **Waypoint 编辑器**（地图点击 + 列表）
6. **Mission 上传/下载**
7. **Mission 项类型支持**（Takeoff/Waypoint/RTL/Land）

### P2 — 增强体验
8. **姿态仪表**（人工地平线）
9. **预飞检查清单**
10. **告警系统增强**
11. **Geofence / Rally Point**

### P3 — 配置体系
12. **Setup 向导框架**
13. **传感器校准流程**
14. **飞行模式配置**

### P4 — 分析工具
15. **MAVLink 检查器**
16. **日志分析增强**

### P5 — 高级功能
17. **多机管理**
18. **视频流**
19. **3D 视图**
20. **ArduPilot 双栈适配**
