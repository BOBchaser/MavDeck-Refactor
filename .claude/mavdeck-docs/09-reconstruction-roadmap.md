# 重构路线图（基于讨论.md）

## 当前状态

**方向已确定**（mentor 已认可）：
1. 基于 `MavDeck` 做 Web 地面站升级
2. 尽量复现 `QGroundControl` 的核心内容
3. 目标上兼容 `PX4-Autopilot` 与 `ArduPilot`
4. 实施顺序上先从 `PX4-Autopilot` 开始
5. 按通用 GCS 路线推进，不专门为无人船改功能体系
6. 分阶段复现，逐阶段和 mentor 审核

---

## MavDeck 当前能力 vs QGC 目标差距

### MavDeck 已有（可作为底座复用）
- Web 原生 + PWA 基础设施
- MAVLink 完整协议栈（解析/解码/CRC/注册表）
- Web Serial / WebUSB 连接能力
- 高性能数据管道（Worker、零拷贝、环形缓冲区）
- uPlot 图表系统（时间序列、联动缩放）
- Leaflet 地图（实时轨迹、回放、图层切换）
- 参数基础读写（列表、搜索、分组）
- Tlog 录制与回放（OPFS + IndexedDB）
- 消息监控与频率统计
- 状态文本日志
- 调试控制台
- 主题/单位/设置持久化
- 完善的测试体系

### QGC 核心能力（MavDeck 仍缺）
1. **操作闭环**
   - Arm / Disarm
   - 模式切换（Manual、PosCtl、Auto、RTL、Hold 等）
   - Guided 模式控制（goto、takeoff、land）
   - 常用 Vehicle Action

2. **状态总览**
   - 飞行/航行模式显示
   - GPS / 电池 / 链路 / EKF / 传感器健康状态
   - 告警和状态提示
   - 预飞检查清单

3. **任务规划（Plan）**
   - Waypoint 编辑（地图点击添加、拖拽调整）
   - Mission 上传 / 下载
   - Mission 列表与地图联动
   - 当前任务进度显示
   - Geofence / Rally Point

4. **配置工作流（Setup）**
   - 不仅是参数列表，而是向导式配置
   - 传感器校准流程
   - 遥控器配置
   - 飞行模式配置
   - 电源/安全设置

5. **分析工具（Analyze）**
   - 日志分析增强
   - MAVLink 检查器
   - 控制台/终端

6. **页面组织**
   - Fly / Plan / Setup / Analyze 工作区概念
   - 清晰的任务流程组织

7. **多 Autopilot 兼容**
   - PX4 模式映射
   - ArduPilot 模式映射
   - PX4 / ArduPilot 参数差异适配
   - 特定命令差异处理

---

## 六阶段实施路线

### 阶段 1：连接、遥测、基础飞行视图补齐

**目标**：让 MavDeck 更像一个能用的基础 GCS 主界面（基础版 Fly View）

**工作内容**：
- 设备连接稳定化（已有基础，需增强状态显示）
- 心跳 / 基础状态识别（HEARTBEAT 解析增强）
- 基础遥测总览（姿态、位置、速度、高度、电池）
- 地图与当前位置/轨迹显示（已有）
- **新增**：模式、armed 状态、GPS、电池、链路状态的综合状态面板
- **新增**：状态文本 / 告警区增强
- **新增**：基础 action 按钮（Arm/Disarm、模式切换入口）

**产出目标**：
- 能像基础版 Fly View 那样工作
- 能支撑基本监控和基础操作

**可利用的现有代码**：
- `MessageMonitor.tsx` — 已有消息解析和频率统计
- `MapView.tsx` — 已有地图和轨迹
- `StatusBar.tsx` — 已有状态栏框架
- `mavlink/` 引擎 — 完整的消息编解码能力
- `WorkerController.sendMavlinkMessage()` — 已具备发送能力

**需新增/修改**：
- 新的状态总览组件（类似 QGC 的 instrument panel）
- Arm/Disarm 按钮和确认流程
- 模式切换 UI
- 增强的告警显示

---

### 阶段 2：控制操作与模式闭环

**目标**：补齐成熟 GCS 最关键的控制面板能力

**工作内容**：
- **Arm / Disarm** 完整流程（含安全确认）
- **Mode Switch**：Manual、PosCtl、Auto、RTL、Hold、Guided 等
- **常用 Action**：Takeoff、Land、Return、Emergency Stop
- **Guided 模式**：Goto point、Orbit、Follow me
- Vehicle 状态变化反馈
- PX4 模式映射先行梳理

**产出目标**：
- 能完成最核心的地面站控制闭环

**技术要点**：
- 需要新增 MAVLink 命令发送能力：
  - `MAV_CMD_COMPONENT_ARM_DISARM`
  - `MAV_CMD_DO_SET_MODE`
  - `MAV_CMD_NAV_TAKEOFF`
  - `MAV_CMD_NAV_LAND`
  - `MAV_CMD_NAV_RETURN_TO_LAUNCH`
  - `MAV_CMD_DO_REPOSITION`（Guided goto）
- 命令确认机制（COMMAND_ACK 处理）
- 超时和重试
- 状态反馈到 UI

**可利用的现有代码**：
- `WorkerController.sendMavlinkMessage()` — 发送框架已就绪
- `frame-builder.ts` — 构建命令帧
- `decoder.ts` — 解析 COMMAND_ACK

---

### 阶段 3：任务规划（Plan）能力

**目标**：开始复现 QGC 的 mission 工作流

**工作内容**：
- Waypoint 编辑（地图点击添加、拖拽调整位置/高度）
- Mission 项类型：Takeoff、Waypoint、RTL、Land、Loiter 等
- Mission 上传 / 下载（MISSION_ITEM_INT 协议）
- Mission 列表与地图联动
- 当前任务进度状态显示（MISSION_CURRENT）
- Mission 基础校验（距离、高度合理性）

**产出目标**：
- 具备基础 Plan View 能力

**技术要点**：
- 新增 MAVLink mission 协议支持：
  - `MISSION_COUNT`, `MISSION_REQUEST`, `MISSION_ITEM_INT`
  - `MISSION_ACK`, `MISSION_CURRENT`, `MISSION_ITEM_REACHED`
- Mission 编辑器状态管理
- 地图上的可交互 waypoint 标记
- Mission 序列校验

---

### 阶段 4：Setup / 参数配置体系升级

**目标**：把"参数列表"升级成"可用配置工作流"

**工作内容**：
- 参数读取/写入流程稳定化（已有基础）
- 参数搜索、分组、分类（已有基础）
- **新增**：常用参数面板（快速访问）
- **新增**：PX4 / ArduPilot 参数差异适配框架
- **新增**：Setup 页面思路（传感器校准、遥控器、飞行模式等向导）
- 逐步靠近 QGC Setup 页面

**产出目标**：
- 不只是能改参数，而是有基本的 setup 体验

**技术要点**：
- 参数元数据系统扩展（已有 `param-metadata-service.ts`）
- Setup 向导框架
- 传感器校准流程（可能需要特定 MAVLink 命令）

---

### 阶段 5：Analyze / 日志 / 回放增强

**目标**：补齐成熟 GCS 的分析能力

**工作内容**：
- 日志查看增强（已有 Tlog 基础）
- 回放体验增强（时间轴控制、速度调节）
- 图表分析增强（更多图表类型、多信号对比）
- 关键状态历史分析

**产出目标**：
- 具备基本分析闭环

**技术要点**：
- 时间轴 UI 组件
- 回放速度控制
- 更多 uPlot 配置选项

---

### 阶段 6：ArduPilot 深化适配

**目标**：在已有 PX4 基础上补齐双栈兼容

**工作内容**：
- ArduPilot 模式映射
- ArduPilot 参数元数据与展示优化
- ArduPilot mission / command 差异兼容
- 双栈 capability 差异管理

**产出目标**：
- 明确进入"双栈可用"状态

**技术要点**：
- Autopilot 适配层抽象
- 模式映射配置
- 参数差异配置

---

## 架构建议：通用 GCS 层 + Autopilot 适配层

```
┌─ 通用 GCS 层 ─────────────────────────────┐
│  地图、遥测、图表、日志、任务 UI、参数 UI    │
│  连接管理、模式与控制总框架                 │
└──────────────┬────────────────────────────┘
               │
┌─ Autopilot 适配层 ────────────────────────┐
│  PX4 模式映射                             │
│  ArduPilot 模式映射                        │
│  PX4 参数组织/元数据处理                    │
│  ArduPilot 参数组织/元数据处理              │
│  特定命令差异处理                           │
│  Mission / Capability 差异处理              │
└───────────────────────────────────────────┘
```

**设计原则**：
- 前端产品形态尽量统一
- 底层逐步形成 PX4 / ArduPilot 差异适配能力
- 适配层配置驱动，不硬编码在 UI 组件中

---

## 核心复用清单

在重构过程中，以下已有代码应**最大化复用**：

| 已有代码 | 路径 | 复用场景 |
|---------|------|---------|
| MAVLink 引擎 | `src/mavlink/` | 所有消息编解码 |
| Worker 基础设施 | `src/workers/` | 数据流和命令发送 |
| 环形缓冲区 | `src/core/ring-buffer.ts` | 时间序列数据 |
| EventEmitter | `src/core/event-emitter.ts` | 组件间通信 |
| Worker Bridge | `src/services/worker-bridge.ts` | Worker 通信门面 |
| ConnectionManager | `src/services/connection-manager.ts` | 连接管理 |
| SerialSessionController | `src/services/serial-session-controller.ts` | 串口生命周期 |
| ParameterManager | `src/services/parameter-manager.ts` | 参数协议 |
| Tlog 系统 | `src/services/tlog-*.ts` | 日志录制回放 |
| MapView | `src/components/MapView.tsx` | 地图基础 |
| PlotChart | `src/components/PlotChart.tsx` | 图表基础 |
| AppStore | `src/store/app-store.ts` | 全局状态 |
| 测试框架 | `__tests__/` | 新增功能测试 |

---

## 当前阶段（阶段 1）的关键任务

基于现有代码，阶段 1 最直接的切入点：

1. **增强 HEARTBEAT 解析**
   - 从 HEARTBEAT 提取：base_mode、custom_mode、system_status、armed 状态
   - PX4 custom_mode 解码（main_mode + sub_mode）

2. **创建状态总览面板**
   - 新的 UI 组件（类似 QGC 的 instrument panel）
   - 显示：模式、armed、电池、GPS、链路质量

3. **添加 Arm/Disarm 按钮**
   - 发送 `MAV_CMD_COMPONENT_ARM_DISARM`
   - 处理 `COMMAND_ACK`
   - 安全确认对话框

4. **添加模式切换下拉/按钮组**
   - PX4 模式列表
   - 发送 `MAV_CMD_DO_SET_MODE`
   - 当前模式高亮

5. **增强告警显示**
   - SYS_STATUS 解析（传感器健康、电池）
   - 视觉告警指示器

**可利用的现有发送能力**：
- `WorkerController.sendMavlinkMessage(name, fields)` — 已支持发送任意 MAVLink 消息
- 只需在 UI 层新增按钮和状态管理，Worker 层基本无需改动
