# QGroundControl 源码架构总览

## 项目基本信息

- **仓库路径**: `/Users/zhengguo/Desktop/taiyi/重构/MavDeck/qgroundcontrol-master/`
- **技术栈**: C++17 / Qt6 / QML
- **总源码文件数**: ~951 个 `.cc/.cpp/.h/.hpp` 文件
- **定位**: 跨平台桌面 GCS，支持 PX4 / ArduPilot / 其他 MAVLink 飞控

---

## 顶层目录结构

```
src/
  FlyView/          — 飞行监控主视图（地图、视频、仪表、工具条）
  PlanView/         — 任务规划视图（航点编辑、Geofence、Rally Point）
  AutoPilotPlugins/ — 飞行器配置插件（PX4 / ArduPilot / 通用）
  AnalyzeView/      — 分析工具（MAVLink 检查器、日志下载、控制台）
  Vehicle/          — 飞行器抽象、Vehicle 类、FactGroup、Setup
  FirmwarePlugin/   — 固件适配层（PX4FirmwarePlugin / APMFirmwarePlugin）
  MissionManager/   — Mission 协议管理器
  MAVLink/          — MAVLink C 库封装、协议解析
  Comms/            — 连接管理（串口、TCP、UDP、蓝牙、MockLink）
  UI/               — UI 组件和主窗口
  QmlControls/      — 可复用 QML 控件
  FactSystem/       — Fact 元数据驱动 UI 系统
  Settings/         — 应用设置持久化
  Utilities/        — 通用工具（状态机、地理、网络、日志）
  Joystick/         — 摇杆输入支持
  VideoManager/     — 视频流管理（GStreamer）
  FlightMap/        — 地图引擎封装
  PositionManager/  — GPS 位置管理
  Terrain/          — 地形数据
  GPS/              — GPS 设备支持
  Camera/           — 相机控制
  Gimbal/           — 云台控制
  ADSB/             — ADS-B 交通感知
  API/              — 外部 API
```

---

## 四大主视图（核心导航）

QGC 的导航围绕四个视图展开，在 `MainWindow.qml` 的 `SelectViewDropdown` 中定义：

| 视图 | 目录 | 核心功能 |
|------|------|---------|
| **Fly** | `src/FlyView/` | 实时监控、地图/视频、仪表、控制操作 |
| **Plan** | `src/PlanView/` | 任务规划、Waypoint 编辑、Geofence、Rally Point |
| **Configure** | `src/AutoPilotPlugins/` + `src/Vehicle/VehicleSetup/` | 飞行器配置、传感器校准、参数、调参 |
| **Analyze** | `src/AnalyzeView/` | MAVLink 检查器、日志下载、控制台 |

---

## 关键架构模式

### 1. FirmwarePlugin 抽象层

所有固件差异隔离在 `FirmwarePlugin` 子类中：

| 文件 | 固件 | 职责 |
|------|------|------|
| `src/FirmwarePlugin/PX4/PX4FirmwarePlugin.cc` | PX4 | 模式映射、引导动作、参数元数据 |
| `src/FirmwarePlugin/APM/ArduCopterFirmwarePlugin.cc` | ArduPilot 多旋翼 | 多旋翼特定模式 |
| `src/FirmwarePlugin/APM/ArduPlaneFirmwarePlugin.cc` | ArduPilot 固定翼 | 固定翼特定模式 |
| `src/FirmwarePlugin/APM/ArduRoverFirmwarePlugin.cc` | ArduPilot 无人车/船 | 无人车模式 |

**基类**: `src/FirmwarePlugin/FirmwarePlugin.h` — 定义通用接口：
- `flightMode(base_mode, custom_mode)` — 解码模式名称
- `setFlightMode(name, base_mode, custom_mode)` — 编码模式
- `guidedModeTakeoff()` / `guidedModeLand()` / `guidedModeRTL()` — 引导动作
- `supportedMissionCommands()` — 支持的 Mission 命令
- `autopilotPlugin()` — 返回 Setup 页面插件

### 2. FactSystem 参数元数据驱动 UI

每个参数都是 `Fact` 对象，带有类型/范围/单位/枚举值元数据：

- `src/FactSystem/Fact.h` — Fact 基类
- `src/FactSystem/FactMetaData.h` — 元数据定义
- `src/FactSystem/ParameterManager.h` — 参数协议管理
- `src/FirmwarePlugin/PX4/PX4ParameterMetaData.json` — PX4 参数元数据 JSON

UI 根据元数据自动生成滑块/开关/下拉框。

### 3. Vehicle 类 — 飞行器状态中心

`src/Vehicle/Vehicle.h` / `Vehicle.cc` — 中央状态机：
- 连接状态、飞行模式、武装状态
- 遥测数据（位置、姿态、速度、电池）
- 命令发送 (`sendMavCommand`, `sendMavCommandInt`)
- 参数管理器引用
- Mission 管理器引用

### 4. 状态机驱动的可靠通信

`src/Utilities/StateMachine/QGCStateMachine.h` — 管理参数写入、Mission 传输等状态协议，带重试和超时。

---

## 关键文件速查表

| 功能 | 文件路径 |
|------|---------|
| PX4 模式解码/编码 | `src/FirmwarePlugin/PX4/PX4FirmwarePlugin.cc` |
| PX4 模式枚举定义 | `src/FirmwarePlugin/PX4/px4_custom_mode.h` |
| 飞行器命令发送 | `src/Vehicle/Vehicle.cc` (`sendMavCommand`) |
| 武装/解除武装 | `src/Vehicle/Vehicle.cc` (`setArmed`, `setArmedShowError`) |
| Mission 协议 | `src/MissionManager/PlanManager.cc` |
| Mission UI | `src/PlanView/MissionController.cc` |
| 连接管理 | `src/Comms/LinkManager.cc` |
| 主窗口 | `src/UI/MainRootWindow.qml` |
| 工具条 | `src/UI/toolbar/MainToolBar.qml` |
| 飞行视图 | `src/FlyView/FlyView.qml` |
| 参数设置 | `src/AutoPilotPlugins/PX4/PX4AutoPilotPlugin.cc` |
| MAVLink 检查器 | `src/AnalyzeView/MAVLinkInspectorPage.qml` |

---

## 与 MavDeck 的对应关系

| QGC 模块 | MavDeck 对应模块 | 差距 |
|---------|-----------------|------|
| `FirmwarePlugin` | 尚无（需创建 `src/autopilot/`） | 架构差距 |
| `Vehicle` | `app-store.ts` + Worker Bridge | 状态聚合差距 |
| `FactSystem` | `param-metadata-service.ts` | 功能差距 |
| `PlanManager` | 尚无 | 大差距 |
| `LinkManager` | `connection-manager.ts` | MavDeck 仅支持 Web Serial |
| `MainToolBar` | `Toolbar.tsx` + `StatusBar.tsx` | UI 差距 |
| `FlyView` | `TelemetryView.tsx` | 功能差距 |
