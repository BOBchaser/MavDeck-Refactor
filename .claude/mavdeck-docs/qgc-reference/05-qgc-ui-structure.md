# QGC UI 结构详解

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/UI/MainRootWindow.qml` | 根窗口、视图切换、工具栏挂载 |
| `src/UI/toolbar/MainToolBar.qml` | 顶部工具栏（模式、电池、GPS、连接状态） |
| `src/FlyView/FlyView.qml` | Fly 视图主界面 |
| `src/PlanView/PlanView.qml` | Plan 视图主界面 |
| `src/AutoPilotPlugins/PX4/PX4AutoPilotPlugin.cc` | Setup 页面组织 |
| `src/AnalyzeView/AnalyzeView.qml` | Analyze 视图 |

---

## 主窗口层次

```
MainRootWindow.qml
├── MainToolBar.qml (顶部固定工具栏)
│   ├── ViewSelectSection.qml      — 视图切换下拉（Fly/Plan/...）
│   ├── ModeIndicator.qml          — 当前飞行模式
│   ├── ArmedIndicator.qml         — 武装状态
│   ├── GPSIndicator.qml           — GPS 状态
│   ├── BatteryIndicator.qml       — 电池状态
│   ├── LinkIndicator.qml          — 连接状态
│   └── MessageIndicator.qml       — 消息/告警
│
├── FlyView.qml (默认视图)
│   ├── FlightDisplayView.qml      — 飞行显示
│   ├── MapView.qml                — 地图
│   ├── VideoView.qml              — 视频流
│   ├── InstrumentPanel.qml        — 仪表面板（姿态、高度、速度）
│   ├── GuidedActionsController.qml— 引导动作控制
│   └── VehicleWarnings.qml        — 告警覆盖层
│
├── PlanView.qml
│   ├── MissionPlanView.qml        — 任务规划
│   ├── GeoFenceEditor.qml         — 围栏编辑
│   └── RallyPointEditor.qml       — 集结点编辑
│
├── SetupView.qml
│   ├── SummaryPage.qml            — 概要
│   ├── FirmwarePage.qml           — 固件
│   ├── PX4/
│   │   ├── AirframeComponent.qml  — 机架
│   │   ├── SensorsComponent.qml   — 传感器校准
│   │   ├── RadioComponent.qml     — 遥控器
│   │   ├── FlightModesComponent.qml — 飞行模式
│   │   ├── PowerComponent.qml     — 电源
│   │   ├── SafetyComponent.qml    — 安全
│   │   └── TuningComponent.qml    — 调参
│   └── APM/ ...
│
└── AnalyzeView.qml
    ├── MAVLinkInspectorPage.qml   — MAVLink 消息检查器
    ├── LogDownloadPage.qml        — 日志下载
    ├── GeoTagPage.qml             — 地理标记
    └── VibrationPage.qml          — 振动分析
```

---

## 顶部工具栏（MainToolBar）

工具栏是 QGC 状态信息的集中展示区：

### 指示器组件

| 指示器 | 文件 | 显示内容 |
|--------|------|---------|
| **模式** | `PX4FlightModeIndicator.qml` | 当前飞行模式名称 |
| **武装** | `ArmedIndicator.qml` | Armed / Disarmed |
| **电池** | `PX4BatteryIndicator.qml` | 电压、电流、剩余百分比 |
| **GPS** | `GPSIndicator.qml` | 卫星数、HDOP、3D Fix 状态 |
| **链路** | `LinkIndicator.qml` | 连接质量、延迟 |
| **消息** | `MessageIndicator.qml` | STATUSTEXT 消息滚动 |

### PX4 专用指示器

`PX4FirmwarePlugin::expandedToolbarIndicatorSource()` 返回 PX4 特定的 QML 源：

```cpp
if (indicatorName == "Battery") {
    return "qrc:/qml/QGroundControl/FirmwarePlugin/PX4/PX4BatteryIndicator.qml";
} else if (indicatorName == "FlightMode") {
    return "qrc:/qml/QGroundControl/FirmwarePlugin/PX4/PX4FlightModeIndicator.qml";
} else if (indicatorName == "MainStatus") {
    return "qrc:/qml/QGroundControl/FirmwarePlugin/PX4/PX4MainStatusIndicator.qml";
}
```

---

## Fly 视图布局

Fly 视图是 GCS 的核心监控界面：

```
+------------------+------------------+
|                  |   Instrument     |
|                  |   Panel          |
|                  |   (姿态/罗盘)     |
|    Map / Video   +------------------+
|    (主显示区)     |   Telemetry      |
|                  |   Values         |
|                  |   (高度/速度...)  |
+------------------+------------------+
|  Guided Action Buttons              |
|  [Takeoff] [Land] [RTL] [Pause]     |
+-------------------------------------+
```

### Instrument Panel（仪表面板）

- **人工地平线**（Attitude Indicator）：俯仰/横滚
- **罗盘**（Compass）：航向
- **高度条**（Altitude）：相对/绝对高度
- **速度条**（Airspeed/Groundspeed）

### Guided Action 按钮条

上下文敏感的按钮，根据当前状态显示可用操作：

| 状态 | 可用按钮 |
|------|---------|
| Disarmed | Arm, Start Mission |
| Armed (地面) | Takeoff, Disarm |
| In Flight | Land, RTL, Pause, Change Alt, Goto |
| In Mission | Pause, RTL, Change Speed |

---

## MavDeck 对应实现

MavDeck 当前缺少以下 UI 组件：

| QGC 组件 | MavDeck 状态 | 计划 |
|---------|-------------|------|
| MainToolBar | 部分有 (`Toolbar.tsx` + `StatusBar.tsx`) | 增强指示器 |
| InstrumentPanel | ❌ 无 | Phase 2: `AttitudeIndicator.tsx` |
| GuidedActionButtons | ❌ 无 | Phase 2: `GuidedActionsStrip.tsx` |
| FlyView 布局 | 部分有 (`TelemetryView.tsx`) | 重构布局 |
| PlanView | ❌ 无 | Phase 4: `PlanView.tsx` |
| SetupView | ❌ 无 | Phase 5: `SetupView.tsx` |

---

## 相关源码位置速查

```
qgroundcontrol-master/
  src/UI/
    MainRootWindow.qml
    toolbar/
      MainToolBar.qml
      ModeIndicator.qml
      ArmedIndicator.qml
      GPSIndicator.qml
      BatteryIndicator.qml
  src/FlyView/
    FlyView.qml
    FlightDisplayView.qml
    GuidedActionsController.qml
  src/FirmwarePlugin/PX4/
    PX4BatteryIndicator.qml
    PX4FlightModeIndicator.qml
    PX4MainStatusIndicator.qml
```
