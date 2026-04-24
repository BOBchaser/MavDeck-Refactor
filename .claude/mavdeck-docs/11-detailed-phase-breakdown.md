# MavDeck → Web GCS 详细阶段拆分（Phase 2.1 ~ 10.5）

> 每个子 Phase 都是**可独立 review、可独立测试、可独立合并**的最小单元。目标：mentor 每周审一个子 Phase，不 overwhelm。

---

## Phase 2：控制闭环（Control Loop）

**总目标**：让 MavDeck 能向飞行器发送指令并处理确认。这是从"看板"变"地面站"的分水岭。

### Phase 2.1 — Worker 命令发送基础设施

**做什么**：
- `worker-protocol.ts`：新增 `sendCommand` WorkerCommand、`commandAck` WorkerEvent
- `worker-controller.ts`：处理 `sendCommand` → 用 `MavlinkFrameBuilder` 构建 `COMMAND_LONG` 帧 → 通过 `byteSource.write()` 发送
- `worker-bridge.ts`：暴露 `sendCommand()` 和 `onCommandAck()`

**利用什么**：
- `MavlinkFrameBuilder`（已有）
- `MavlinkMetadataRegistry` 查消息 ID（已有）
- Worker 协议类型系统（已有）

**产出**：
- UI 可以调用 `bridge.sendCommand(msgName, fields)`
- Worker 能发送任意命令帧
- 测试：mock postEvent 验证命令帧结构

---

### Phase 2.2 — Command Sender 服务 + ACK 跟踪

**做什么**：
- `src/services/command-sender.ts`：封装命令发送 + ACK 等待逻辑
  - 发送命令 → 开始计时器
  - 收到 `COMMAND_ACK` → resolve Promise
  - 超时（5s）→ 重试（最多 3 次）→ 最终 reject
  - 支持取消（unsubscribe + clearTimeout）
- `src/services/__tests__/command-sender.test.ts`

**利用什么**：
- `worker-bridge.sendCommand()` / `onCommandAck()`（2.1 产出）

**产出**：
- `commandSender.send(cmd).then(...).catch(...)` 接口
- 测试：mock ACK / 超时 / 重试 / 取消

---

### Phase 2.3 — Arm/Disarm 按钮 + 安全确认

**做什么**：
- `src/components/ArmDisarmButton.tsx`：大按钮（Armed 绿色 / Disarmed 灰色）
  - Disarm 时：弹出确认对话框（"确认要解锁飞行器吗？"）
  - Force disarm：Shift+点击 或 长按 3 秒紧急锁定
  - 发送 `MAV_CMD_COMPONENT_ARM_DISARM`
  - 显示 pending spinner 直到 ACK
- `src/components/__tests__/ArmDisarmButton.test.tsx`
- `Toolbar.tsx`：挂载按钮到右侧工具区

**利用什么**：
- `commandSender`（2.2 产出）
- `appState.armedState`（已有，Phase 1 产出）
- `appState.connectionStatus`（已有）

**产出**：
- UI 上有一个明显的 Arm/Disarm 按钮
- 点击后飞控响应，按钮状态随 `armedState` 自动更新

---

### Phase 2.4 — 飞行模式选择器

**做什么**：
- `src/components/FlightModeSelector.tsx`：下拉框或分段按钮组
  - 列出 PX4 可设置模式（`PX4_SETTABLE_MODES`）
  - 当前模式高亮（来自 `appState.flightMode`）
  - 发送 `MAV_CMD_DO_SET_MODE`
  - 切换失败时显示错误提示
- `Toolbar.tsx`：挂载到 Arm 按钮旁边

**利用什么**：
- `px4-mode-decoder.ts` 中的 `PX4_SETTABLE_MODES`（Phase 1 产出）
- `commandSender`（2.2 产出）

**产出**：
- 用户可以从下拉框切模式，UI 实时反映当前模式

---

## Phase 3：Guided 操作（Guided Actions）

**总目标**：QGC 左侧工具条的核心功能——一键执行常用飞行操作。

### Phase 3.1 — Guided Actions 按钮组（Takeoff / Land / RTL）

**做什么**：
- `src/components/GuidedActionsStrip.tsx`：垂直/水平按钮条
  - Takeoff（起飞）
  - Land（降落）
  - RTL（返航）
  - 每个按钮带确认对话框
  - 按钮状态：enabled/disabled（未连接时 disable）
- `TelemetryView.tsx` 或全局布局：挂载到合适位置

**利用什么**：
- `commandSender`（2.2 产出）
- `appState.flightMode`、`appState.armedState`（已有）

**产出**：
- 三个基础操作按钮可用

---

### Phase 3.2 — Takeoff 对话框 + 高度输入

**做什么**：
- `src/components/TakeoffDialog.tsx`：模态对话框
  - 输入起飞高度（默认 10m）
  - 单位转换（metric/imperial）
  - 发送 `MAV_CMD_NAV_TAKEOFF`

**利用什么**：
- `commandSender`（2.2 产出）
- 已有单位系统（已有）

**产出**：
- 点击 Takeoff 弹出高度输入框，确认后发送命令

---

### Phase 3.3 — Goto 位置（地图点击）

**做什么**：
- `MapView.tsx`：右键/长按地图 → 弹出 "Fly to here" 菜单
  - 发送 `MAV_CMD_DO_REPOSITION`
  - 目标 lat/lon/alt 从地图事件提取
- 视觉反馈：目标位置临时标记

**利用什么**：
- `commandSender`（2.2 产出）
- Leaflet 地图事件（已有）

**产出**：
- 地图上右键点击 → 飞行器飞向该点

---

### Phase 3.4 — 上下文过滤 + 高级 Guided 操作

**做什么**：
- `GuidedActionsStrip.tsx`：根据当前状态动态显示/隐藏按钮
  - 未 armed：只显示 Arm
  - 已 armed + 在地上：显示 Takeoff
  - 在空中：显示 Land / RTL / Change Altitude / Pause
  - 不在 Guided/PosCtl 模式：Goto disable
- Change Altitude 对话框
- Pause（悬停）按钮 → 发送 `MAV_CMD_DO_REPOSITION` 当前位置

**利用什么**：
- `appState.flightMode`、`appState.armedState`（已有）

**产出**：
- 按钮根据飞行上下文智能显示，不会给用户错误选项

---

## Phase 4：综合状态增强（Telemetry Dashboard）

**总目标**：把 FlightStatusPanel 从"模式+武装"扩展为真正的综合仪表板。

### Phase 4.1 — 电池状态

**做什么**：
- 订阅 `BATTERY_STATUS` 消息
- `FlightStatusPanel.tsx`：显示电压 + 剩余百分比 + 低电量警告色
- 颜色逻辑：>50% 绿，20-50% 黄，<20% 红

**利用什么**：
- `workerBridge.onUpdate()` 已有 BATTERY_STATUS 字段（已有）
- `appState` 新增字段即可

**产出**：
- 面板显示 🔋 14.8V / 87%

---

### Phase 4.2 — GPS 状态

**做什么**：
- 订阅 `GPS_RAW_INT` 消息
- `FlightStatusPanel.tsx`：显示卫星数 + fix 类型（3D Fix / 2D Fix / No Fix）
- fix 类型颜色：3D Fix 绿，其他黄/红

**利用什么**：
- `GPS_RAW_INT` 字段已在 MessageMonitor 中可见（已有）

**产出**：
- 面板显示 🛰️ 12 / 3D Fix

---

### Phase 4.3 — 传感器健康摘要

**做什么**：
- 订阅 `SYS_STATUS` 消息
- 解析 `onboard_control_sensors_health` 位掩码
- `FlightStatusPanel.tsx` 或独立小面板：
  - 显示各传感器状态（GPS、Accel、Gyro、Mag、Baro、Airspeed...）
  - 全部健康 = 绿色勾，任一异常 = 红色警告

**利用什么**：
- `SYS_STATUS` 字段（已有）

**产出**：
- 一目了然的传感器健康状态

---

### Phase 4.4 — 告警系统（视觉覆盖层）

**做什么**：
- `src/components/AlertOverlay.tsx`：屏幕顶部/中央告警条
  - 严重（红色）：crash、低电量、GPS loss
  - 警告（黄色）：传感器异常、罗盘干扰
  - 信息（蓝色）：模式切换、任务完成
- 订阅 `STATUSTEXT` + `SYS_STATUS` 健康位变化
- 自动消失（5s）或手动关闭

**利用什么**：
- `workerBridge.onStatusText()`（已有）
- `StatusTextLog.tsx` 已有日志逻辑（已有）

**产出**：
- 出现严重问题时屏幕上有明显的视觉告警，不只是底部的文本日志

---

## Phase 5：姿态仪表（Flight Instruments）

**总目标**：QGC Fly View 左侧的人工地平线 + 罗盘 + 小仪表。

### Phase 5.1 — 人工地平线（Attitude Indicator）

**做什么**：
- `src/components/AttitudeIndicator.tsx`：Canvas/SVG 绘制
  - 订阅 `ATTITUDE` 消息（roll, pitch）
  - 绘制地平线、俯仰刻度、横滚指针
  - 适配 light/dark 主题

**利用什么**：
- `ATTITUDE` 消息（已有，MessageMonitor 已能显示）

**产出**：
- 一个实时更新的姿态球

---

### Phase 5.2 — 罗盘 / 航向指示器

**做什么**：
- `src/components/CompassIndicator.tsx`：圆形罗盘
  - 订阅 `ATTITUDE.yaw` 或 `VFR_HUD.heading`
  - 显示航向角（0-360°）
  - 显示当前目标航向（如果有）

**利用什么**：
- `ATTITUDE` / `VFR_HUD`（已有）

**产出**：
- 罗盘小部件

---

### Phase 5.3 — 空速 / 地速 / 高度小仪表

**做什么**：
- `src/components/MiniInstruments.tsx`：一排小数字仪表
  - 空速（`VFR_HUD.airspeed`）
  - 地速（`VFR_HUD.groundspeed`）
  - 高度（`VFR_HUD.alt`）
  - 爬升率（`VFR_HUD.climb`）
  - 单位自动转换

**利用什么**：
- `VFR_HUD` 消息（已有）
- 已有单位系统（已有）

**产出**：
- 类似飞机 PFD 底部的一排小仪表

---

## Phase 6：任务规划（Plan View）

**总目标**：QGC 的 Plan View — 航点编辑、任务上传下载。

### Phase 6.1 — Plan View 页面框架

**做什么**：
- `src/components/PlanView.tsx`
- `App.tsx`：新增 "Plan" Tab
- 布局：左侧 Mission 列表 + 右侧地图（复用 MapView）

**利用什么**：
- `MapView.tsx`（已有）
- `App.tsx` Tab 切换逻辑（已有）

**产出**：
- 点击 Plan Tab 进入新视图

---

### Phase 6.2 — 地图航点交互

**做什么**：
- `MapView.tsx` 或 Plan 专用地图：
  - 点击地图 → 添加 Waypoint 标记
  - 拖拽标记 → 更新 lat/lon
  - 点击标记 → 选中 / 删除
  - 航点之间连线（polyline）

**利用什么**：
- Leaflet（已有）

**产出**：
- 在地图上可视化编辑航线

---

### Phase 6.3 — Mission 列表侧边栏

**做什么**：
- `src/components/MissionItemList.tsx`：可拖拽排序的列表
  - 显示序号、类型（Takeoff/Waypoint/RTL/Land）、lat/lon/alt
  - 点击选中 → 地图高亮对应标记
  - 删除、上移、下移

**利用什么**：
- SolidJS `For` / `Index`（已有）

**产出**：
- 左侧列表和地图标记联动

---

### Phase 6.4 — Mission 项编辑器

**做什么**：
- `src/components/MissionItemEditor.tsx`：选中航点后右侧/弹窗编辑
  - 类型下拉（Takeoff / Waypoint / RTL / Land / Loiter）
  - lat / lon / alt 输入
  - 参数：停留时间、接受半径、通过半径

**利用什么**：
- 已有表单组件模式（可参考 ParameterDetail）

**产出**：
- 点击航点可编辑参数

---

### Phase 6.5 — Mission 下载（从飞控读取）

**做什么**：
- `src/services/mission-manager.ts`：状态机
  - 发送 `MISSION_REQUEST_LIST` → 收到 `MISSION_COUNT` → 逐个 `MISSION_REQUEST_INT` → 收集 `MISSION_ITEM_INT`
  - 超时重试、错误处理
- UI："Download from Vehicle" 按钮 + 进度条

**利用什么**：
- Worker 命令发送框架（2.1）
- `MavlinkFrameBuilder`（已有）

**产出**：
- 点击下载，飞控上的任务加载到本地编辑器

---

### Phase 6.6 — Mission 上传（写入飞控）

**做什么**：
- `mission-manager.ts`：上传状态机
  - 发送 `MISSION_COUNT` → 收到 `MISSION_REQUEST` → 逐个发送 `MISSION_ITEM_INT` → 收到 `MISSION_ACK`
- UI："Upload to Vehicle" 按钮 + 进度条
- 上传前校验（距离、高度合理性）

**利用什么**：
- 同 6.5

**产出**：
- 编辑器里的任务可以写入飞控

---

### Phase 6.7 — 当前任务进度

**做什么**：
- 订阅 `MISSION_CURRENT` 和 `MISSION_ITEM_REACHED`
- Plan View / Fly View 显示当前执行到的航点序号
- 地图高亮当前目标航点

**利用什么**：
- Worker 数据流（已有）

**产出**：
- 实时看到飞控在执行第几个航点

---

### Phase 6.8 — Geofence 编辑器

**做什么**：
- 地图上绘制多边形围栏
- 围栏上传/下载（`FENCE_POINT` 协议或 MAVLink 2 围栏消息）
- 列表管理（启用/禁用/删除）

**利用什么**：
- 地图交互能力（6.2 产出）

**产出**：
- 基础 Geofence 支持

---

### Phase 6.9 — Rally Point 编辑器

**做什么**：
- 地图上标记 Rally Point（紧急降落点）
- 上传/下载
- 列表管理

**利用什么**：
- 同 6.8

**产出**：
- 基础 Rally Point 支持

---

## Phase 7：Setup 向导

**总目标**：把"参数列表"升级为"向导式配置"。

### Phase 7.1 — Setup View 框架

**做什么**：
- `src/components/SetupView.tsx`
- `App.tsx`：新增 "Setup" Tab
- 侧边栏导航：Sensors / Radio / Flight Modes / Power / Safety
- 右侧内容区根据导航切换

**利用什么**：
- `App.tsx` Tab 逻辑（已有）

**产出**：
- Setup 页面框架

---

### Phase 7.2 — 传感器校准（罗盘）

**做什么**：
- `src/components/setup/CompassCalibration.tsx`
- 向导：步骤 1/2/3（旋转飞行器）
- 发送校准命令（MAVLink `COMMAND_LONG` 特定命令）
- 实时显示校准进度和结果

**利用什么**：
- `commandSender`（2.2 产出）
- 参数系统（已有）

**产出**：
- 罗盘校准向导 UI

---

### Phase 7.3 — 传感器校准（加速度计 + 陀螺仪 + 水平）

**做什么**：
- 类似 7.2，但对应 accel/gyro/level 校准
- 不同校准有不同的放置要求（6 面旋转 / 水平放置）

**利用什么**：
- 同 7.2

**产出**：
- 完整的传感器校准向导

---

### Phase 7.4 — 遥控器配置

**做什么**：
- `src/components/setup/RadioConfig.tsx`
- 显示遥控器通道映射
- 发送通道校准命令
- 可视化摇杆位置（如果有 MAVLink RC_CHANNELS 数据）

**利用什么**：
- `RC_CHANNELS` 消息（已有）

**产出**：
- 遥控器配置页面

---

### Phase 7.5 — 飞行模式开关映射

**做什么**：
- `src/components/setup/FlightModeConfig.tsx`
- 显示当前模式开关对应的通道和 PWM 范围
- 允许调整映射（通过参数写入）

**利用什么**：
- 参数系统（已有）
- PX4 模式列表（Phase 1 产出）

**产出**：
- 模式开关配置 UI

---

### Phase 7.6 — 电源 / 安全设置

**做什么**：
- `src/components/setup/PowerConfig.tsx`
- 电池类型、电压阈值、低电量动作
- `src/components/setup/SafetyConfig.tsx`
- 返航高度、地理围栏开关、故障保护动作
- 所有通过参数读写实现

**利用什么**：
- 参数系统（已有）

**产出**：
- 电源和安全配置向导

---

### Phase 7.7 — 机架选择向导

**做什么**：
- `src/components/setup/AirframeConfig.tsx`
- 机架类型列表（多旋翼 / 固定翼 / VTOL / 无人车 / 无人船）
- 选择后自动设置对应参数组

**利用什么**：
- 参数系统（已有）

**产出**：
- 机架选择 UI

---

## Phase 8：预飞检查（Pre-flight Checklist）

**总目标**：QGC 的预飞检查，决定 canArm / canTakeoff。

### Phase 8.1 — 检查清单框架

**做什么**：
- `src/components/PreFlightChecklist.tsx`：可折叠检查列表
- 每个检查项：名称、状态（通过/警告/失败）、描述
- 总体状态：绿色（可以起飞）/ 黄色（注意）/ 红色（不能起飞）

**产出**：
- 检查清单 UI 框架

---

### Phase 8.2 — 传感器健康检查

**做什么**：
- 检查 `SYS_STATUS` sensors_present / sensors_enabled / sensors_health
- 如果有传感器未健康 → 标记为失败

**利用什么**：
- `SYS_STATUS`（已有）

**产出**：
- 自动判断传感器状态

---

### Phase 8.3 — GPS / 定位检查

**做什么**：
- 检查 `GPS_RAW_INT.fix_type`（要求 ≥ 3）
- 检查卫星数（要求 ≥ 8）
- 检查 `EKF_STATUS_REPORT`（如果可用）

**产出**：
- GPS 定位质量检查

---

### Phase 8.4 — 电池 / 电量检查

**做什么**：
- 检查 `BATTERY_STATUS.battery_remaining`
- 低于安全阈值 → 失败

**产出**：
- 电池电量检查

---

### Phase 8.5 — 参数一致性检查

**做什么**：
- 检查关键参数是否在安全范围内
  - 返航高度 > 0
  - 地理围栏已启用（如果适用）
- 参数未加载 → 警告

**利用什么**：
- 参数系统（已有）

**产出**：
- 参数配置完整性检查

---

### Phase 8.6 — 解锁条件综合判断

**做什么**：
- 综合所有检查项，计算 `canArm` / `canTakeoff`
- `ArmDisarmButton.tsx`：如果 `canArm === false`，按钮 disable 并显示原因 tooltip
- 显示总体状态摘要

**利用什么**：
- 8.1 ~ 8.5 的所有检查逻辑

**产出**：
- 飞行器不满足起飞条件时，UI 明确告诉用户为什么

---

## Phase 9：分析工具增强（Analyze）

**总目标**：QGC Analyze View 的 Web 化。

### Phase 9.1 — MAVLink 检查器

**做什么**：
- `src/components/MavlinkInspector.tsx`
- 结构化查看所有 MAVLink 消息（类似 MessageMonitor 但更全面）
- 十六进制原始帧查看
- 消息过滤和搜索

**利用什么**：
- `MessageMonitor.tsx`（已有，可作为基础）

**产出**：
- 高级 MAVLink 消息检查工具

---

### Phase 9.2 — 日志回放增强

**做什么**：
- 时间轴滑块（拖动跳转）
- 播放/暂停/停止按钮
- 回放速度调节（0.5x / 1x / 2x / 4x）
- 当前时间戳显示

**利用什么**：
- `LogViewerService`（已有）

**产出**：
- 类似视频播放器的日志回放控制

---

### Phase 9.3 — 振动分析

**做什么**：
- `src/components/VibrationAnalysis.tsx`
- 订阅 `VIBRATION` 消息
- 显示三轴振动柱状图/时序图
- 超标警告

**利用什么**：
- `VIBRATION` 消息（已有）
- uPlot（已有）

**产出**：
- 振动分析面板

---

### Phase 9.4 — 机载日志下载

**做什么**：
- 通过 MAVLink FTP 或 SD 卡协议下载飞控上的 `.ulg`/`.bin` 日志
- 进度条显示
- 下载后本地浏览

**利用什么**：
- FTP 客户端（已有 `ftp-client.ts`）

**产出**：
- 从飞控下载机载日志到浏览器

---

## Phase 10：多 Autopilot 适配

**总目标**：把 PX4 硬编码逻辑抽象成适配层，接入 ArduPilot。

### Phase 10.1 — AutopilotAdapter 接口设计

**做什么**：
- `src/autopilot/autopilot-adapter.ts`：定义接口
  - `getModeList()` → 可设置模式列表
  - `decodeCustomMode(baseMode, customMode)` → 模式名称
  - `getSetupPages()` → Setup 向导页面配置
  - `getCommandForAction(action)` → 动作到 MAVLink 命令的映射
  - `getParamGroups()` → 参数分组逻辑

**产出**：
- 统一的适配器接口

---

### Phase 10.2 — PX4 适配器实现

**做什么**：
- `src/autopilot/px4-adapter.ts`
- 把现有的 `px4-mode-decoder.ts`、PX4 特定逻辑迁移到这里
- `use-bootstrap.ts`：检测到 PX4 时实例化 `Px4Adapter`

**产出**：
- 现有 PX4 逻辑被封装到适配器中

---

### Phase 10.3 — ArduPilot 模式解码

**做什么**：
- `src/autopilot/ardupilot-mode-decoder.ts`
- 解码 ArduPilot 的 `custom_mode`（Copter / Plane / Rover / Sub 各有不同）
- 模式映射表（参考 QGC `ArduCopterFirmwarePlugin.cc`）

**产出**：
- ArduPilot 模式名称解码

---

### Phase 10.4 — ArduPilot 适配器实现

**做什么**：
- `src/autopilot/ardupilot-adapter.ts`
- ArduPilot 特有的：
  - 模式列表（Copter vs Plane vs Rover 差异大）
  - 参数分组逻辑（ArduPilot 参数组织与 PX4 不同）
  - 命令差异（某些动作的命令 ID 或参数不同）

**产出**：
- ArduPilot 完整适配

---

### Phase 10.5 — 自动检测 + 动态切换

**做什么**：
- `use-bootstrap.ts`：从 `HEARTBEAT.autopilot` 字段自动判断飞控类型
- 动态实例化对应适配器
- UI 根据适配器返回的配置自动渲染（模式列表、Setup 页面等）
- 支持飞行中切换飞行器（多机场景的基础）

**产出**：
- 连接 PX4 → 显示 PX4 模式列表和 Setup 页面
- 连接 ArduPilot → 自动切换为 ArduPilot 配置

---

## 附录：Mentor Review 建议节奏

| 周 | 子 Phase | 产出物 |
|----|---------|--------|
| 1 | 2.1 + 2.2 | 命令发送基础设施 + ACK 跟踪服务 |
| 2 | 2.3 + 2.4 | Arm/Disarm 按钮 + 模式选择器 |
| 3 | 3.1 + 3.2 | Takeoff/Land/RTL + 起飞对话框 |
| 4 | 3.3 + 3.4 | Goto + 上下文过滤 |
| 5 | 4.1 ~ 4.3 | 电池/GPS/传感器健康面板 |
| 6 | 4.4 | 告警系统 |
| 7 | 5.1 + 5.2 | 姿态球 + 罗盘 |
| 8 | 5.3 | 小仪表 |
| 9 | 6.1 + 6.2 | Plan View 框架 + 地图航点交互 |
| 10 | 6.3 + 6.4 | Mission 列表 + 编辑器 |
| 11 | 6.5 + 6.6 | Mission 下载 + 上传 |
| 12 | 6.7 ~ 6.9 | 进度 + Geofence + Rally Point |
| 13 | 7.1 + 7.2 | Setup 框架 + 罗盘校准 |
| 14 | 7.3 ~ 7.5 | 其他传感器校准 + 遥控器 + 模式映射 |
| 15 | 7.6 + 7.7 | 电源/安全 + 机架选择 |
| 16 | 8.1 ~ 8.3 | 预飞检查框架 + 传感器/GPS 检查 |
| 17 | 8.4 ~ 8.6 | 电池/参数检查 + 综合判断 |
| 18 | 9.1 + 9.2 | MAVLink 检查器 + 回放增强 |
| 19 | 9.3 + 9.4 | 振动分析 + 机载日志下载 |
| 20 | 10.1 + 10.2 | 适配器接口 + PX4 迁移 |
| 21 | 10.3 + 10.4 | ArduPilot 解码 + 适配器 |
| 22 | 10.5 | 自动检测 + 动态切换 |

> 当然，实际节奏可以根据 mentor 反馈调整。这个拆分的原则是：**每个子 Phase 都是一个可独立运行、可独立 review 的最小功能单元。**
