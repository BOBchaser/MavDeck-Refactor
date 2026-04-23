# PX4-Autopilot 源码架构总览

## 项目基本信息

- **仓库路径**: `/Users/zhengguo/Desktop/taiyi/重构/MavDeck/PX4-Autopilot-main/`
- **技术栈**: C++17 / NuttX RTOS / uORB 发布订阅 / uORB 消息定义
- **总模块数**: ~80+ 个 `src/modules/` 子目录
- **定位**: 开源自动驾驶仪固件，支持多旋翼、固定翼、VTOL、无人车、无人船、潜艇

---

## 顶层目录结构

```
src/
  modules/          — 核心功能模块（~80+ 个）
  lib/              — 库（控制、数学、geo、参数、传感器驱动等）
  drivers/          — 硬件驱动（传感器、执行器、总线等）
  platforms/        — 平台抽象（NuttX、POSIX、Qurt）
  include/          — 公共头文件
  systemcmds/       — 系统命令（shell 工具）
  examples/         — 示例代码
msg/
  versioned/        — uORB 消息定义（.msg 文件）
  unversioned/      — 未版本化的 uORB 消息
ROMFS/
  px4fmu_common/    — 通用 ROM 文件系统（启动脚本、混控器、参数默认值）
tools/              — 构建和开发工具
CMakeLists.txt      — 主构建配置
```

---

## 核心模块速查

| 模块 | 路径 | 职责 |
|------|------|------|
| **commander** | `src/modules/commander/` | 飞行状态机、武装、模式切换、健康检查、故障保护 |
| **mavlink** | `src/modules/mavlink/` | MAVLink 协议栈、与地面站通信 |
| **navigator** | `src/modules/navigator/` | 自动飞行任务执行（Mission、RTL、Land、Loiter） |
| **flight_mode_manager** | `src/modules/flight_mode_manager/` | 飞行模式管理、手动模式映射 |
| **mc_pos_control** | `src/modules/mc_pos_control/` | 多旋翼位置控制 |
| **mc_att_control** | `src/modules/mc_att_control/` | 多旋翼姿态控制 |
| **fw_mode_manager** | `src/modules/fw_mode_manager/` | 固定翼模式管理 |
| **fw_att_control** | `src/modules/fw_att_control/` | 固定翼姿态控制 |
| **ekf2** | `src/modules/ekf2/` | 扩展卡尔曼滤波（状态估计） |
| **sensors** | `src/modules/sensors/` | 传感器聚合、投票、校准 |
| **land_detector** | `src/modules/land_detector/` | 着陆检测 |
| **battery_status** | `src/modules/battery_status/` | 电池状态估计 |
| **dataman** | `src/modules/dataman/` | 持久化存储（任务、地理围栏、参数） |
| **logger** | `src/modules/logger/` | 机载日志（ulog） |
| **events** | `src/modules/events/` | libevents 健康检查事件 |
| **manual_control** | `src/modules/manual_control/` | 遥控器输入处理 |
| **rc_update** | `src/modules/rc_update/` | RC 信号更新 |
| **control_allocator** | `src/modules/control_allocator/` | 控制分配（混控） |
| **gyro_calibration** | `src/modules/gyro_calibration/` | 陀螺仪校准 |
| **gimbal** | `src/modules/gimbal/` | 云台控制 |
| **vtol_att_control** | `src/modules/vtol_att_control/` | VTOL 过渡控制 |

### 无人车/船特定模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **rover_ackermann** | `src/modules/rover_ackermann/` | 阿克曼转向无人车控制 |
| **rover_differential** | `src/modules/rover_differential/` | 差速转向无人车控制 |
| **rover_mecanum** | `src/modules/rover_mecanum/` | 麦克纳姆轮无人车控制 |
| **uuv_att_control** | `src/modules/uuv_att_control/` | 水下航行器姿态控制 |
| **uuv_pos_control** | `src/modules/uuv_pos_control/` | 水下航行器位置控制 |

---

## uORB 发布订阅系统

PX4 的核心通信机制：

```
发布者 ──> uORB topic ──> 订阅者
```

### 关键 uORB Topic（与地面站相关）

| Topic | 文件 | 内容 |
|-------|------|------|
| `vehicle_status` | `msg/versioned/VehicleStatus.msg` | 飞行模式、武装状态、健康状态 |
| `vehicle_global_position` | `msg/versioned/VehicleGlobalPosition.msg` | WGS84 位置 |
| `vehicle_local_position` | `msg/versioned/VehicleLocalPosition.msg` | 本地坐标位置 |
| `vehicle_attitude` | `msg/versioned/VehicleAttitude.msg` | 姿态四元数 |
| `battery_status` | `msg/versioned/BatteryStatus.msg` | 电池状态 |
| `sensor_gps` | `msg/versioned/SensorGps.msg` | GPS 原始数据 |
| `telemetry_status` | `msg/versioned/TelemetryStatus.msg` | 遥测链路状态 |
| `mission_result` | `msg/versioned/MissionResult.msg` | 任务执行结果 |
| `geofence_result` | `msg/versioned/GeofenceResult.msg` | 围栏状态 |
| `commander_status` | `msg/versioned/CommanderStatus.msg` | Commander 状态 |
| `actuator_outputs` | `msg/versioned/ActuatorOutputs.msg` | 执行器输出 |

---

## MAVLink 模块架构

`src/modules/mavlink/` 是 PX4 与 GCS 通信的桥梁：

| 文件 | 职责 |
|------|------|
| `mavlink_main.cpp` | 模块入口、主循环 |
| `mavlink_receiver.cpp` | 接收并处理来自 GCS 的 MAVLink 消息 |
| `mavlink_messages.cpp` | 生成并发送 MAVLink 消息到 GCS |
| `mavlink_command_sender.cpp` | 命令发送管理 |
| `mavlink_mission.cpp` | Mission 协议实现 |
| `mavlink_parameters.cpp` | 参数协议实现 |
| `mavlink_ftp.cpp` | MAVLink FTP 实现 |
| `mavlink_stream.h` | 流管理 |

---

## 启动流程

PX4 启动脚本位于 `ROMFS/px4fmu_common/init.d/`：

```
rcS           — 主启动脚本
rc.sensors    — 传感器初始化
rc.mavlink    — MAVLink 启动
rc.autostart  — 自动启动（根据机架类型加载参数）
rc.logging    — 日志启动
```

### 无人车/船启动

```
ROMFS/px4fmu_common/init.d-posix/airframes/     — SITL 机架配置
ROMFS/px4fmu_common/init.d/airframes/            — 真实机架配置
  ├── 50000_generic_ground_vehicle               — 通用地面载具
  ├── 50001_axialracing_ax10                     — 特定无人车
  └── ...
```

---

## 与 MavDeck 的对应关系

| PX4 模块 | MavDeck 关注点 | 说明 |
|---------|--------------|------|
| `commander` | HEARTBEAT 生成、模式切换 | 核心状态机 |
| `mavlink` | 消息收发、命令处理 | 通信桥梁 |
| `navigator` | MISSION_CURRENT、MISSION_ITEM_REACHED | 任务执行 |
| `vehicle_status` | HEARTBEAT.custom_mode 来源 | uORB → MAVLink |
| `battery_status` | SYS_STATUS 电池字段 | 电源状态 |
| `sensor_gps` | GPS_RAW_INT、GLOBAL_POSITION_INT | 定位 |
| `sensors` | SYS_STATUS 传感器健康 | 传感器状态 |
| `events` | libevents 健康检查 | 预飞检查 |

---

## 关键文件速查表

| 功能 | 文件路径 |
|------|---------|
| 模式定义 | `src/modules/commander/px4_custom_mode.h` |
| 飞行状态 | `msg/versioned/VehicleStatus.msg` |
| 武装状态机 | `src/modules/commander/Commander.cpp` |
| MAVLink 消息发送 | `src/modules/mavlink/mavlink_messages.cpp` |
| MAVLink 命令接收 | `src/modules/mavlink/mavlink_receiver.cpp` |
| Mission 协议 | `src/modules/mavlink/mavlink_mission.cpp` |
| 参数协议 | `src/modules/mavlink/mavlink_parameters.cpp` |
| 传感器校准 | `src/modules/sensors/` |
| 电池状态 | `src/modules/battery_status/` |
| 着陆检测 | `src/modules/land_detector/` |
| EKF 状态估计 | `src/modules/ekf2/` |
