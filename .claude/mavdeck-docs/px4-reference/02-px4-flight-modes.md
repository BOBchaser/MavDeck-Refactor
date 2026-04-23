# PX4 飞行模式详解

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/modules/commander/px4_custom_mode.h` | custom_mode 编码定义、nav_state 映射 |
| `msg/versioned/VehicleStatus.msg` | nav_state 枚举、武装状态、健康状态 |
| `src/modules/commander/Commander.cpp` | 模式切换、武装状态机 |
| `src/modules/commander/HealthAndArmingChecks/` | 预飞检查、健康报告 |
| `src/modules/flight_mode_manager/` | 模式管理器 |

---

## px4_custom_mode 编码

PX4 通过 `HEARTBEAT.custom_mode` (uint32_t) 向 GCS 报告当前飞行模式。

### Union 定义

```cpp
union px4_custom_mode {
    struct {
        uint16_t reserved;   // bits 16-31
        uint8_t  main_mode;  // bits 8-15
        uint8_t  sub_mode;   // bits 0-7
    };
    uint32_t data;
    float    data_float;
    struct {
        uint16_t reserved_hl;
        uint16_t custom_mode_hl;  // 高延迟模式用
    };
};
```

### 主模式枚举

```cpp
enum PX4_CUSTOM_MAIN_MODE {
    PX4_CUSTOM_MAIN_MODE_MANUAL         = 1,
    PX4_CUSTOM_MAIN_MODE_ALTCTL         = 2,
    PX4_CUSTOM_MAIN_MODE_POSCTL         = 3,
    PX4_CUSTOM_MAIN_MODE_AUTO           = 4,
    PX4_CUSTOM_MAIN_MODE_ACRO           = 5,
    PX4_CUSTOM_MAIN_MODE_OFFBOARD       = 6,
    PX4_CUSTOM_MAIN_MODE_STABILIZED     = 7,
    PX4_CUSTOM_MAIN_MODE_RATTITUDE_LEGACY = 8,
    PX4_CUSTOM_MAIN_MODE_SIMPLE         = 9,  /* unused, reserved */
    PX4_CUSTOM_MAIN_MODE_TERMINATION    = 10,
    PX4_CUSTOM_MAIN_MODE_ALTITUDE_CRUISE = 11,
};
```

### Auto 子模式枚举

```cpp
enum PX4_CUSTOM_SUB_MODE_AUTO {
    PX4_CUSTOM_SUB_MODE_AUTO_READY           = 1,
    PX4_CUSTOM_SUB_MODE_AUTO_TAKEOFF         = 2,
    PX4_CUSTOM_SUB_MODE_AUTO_LOITER          = 3,
    PX4_CUSTOM_SUB_MODE_AUTO_MISSION         = 4,
    PX4_CUSTOM_SUB_MODE_AUTO_RTL             = 5,
    PX4_CUSTOM_SUB_MODE_AUTO_LAND            = 6,
    PX4_CUSTOM_SUB_MODE_AUTO_RESERVED_DO_NOT_USE = 7,  // 原 RTGS, 已删除
    PX4_CUSTOM_SUB_MODE_AUTO_FOLLOW_TARGET   = 8,
    PX4_CUSTOM_SUB_MODE_AUTO_PRECLAND        = 9,
    PX4_CUSTOM_SUB_MODE_AUTO_VTOL_TAKEOFF    = 10,
    PX4_CUSTOM_SUB_MODE_AUTO_EXTERNAL1       = 11,
    // ... EXTERNAL2-8
};
```

### PosCtl 子模式枚举

```cpp
enum PX4_CUSTOM_SUB_MODE_POSCTL {
    PX4_CUSTOM_SUB_MODE_POSCTL_POSCTL = 0,
    PX4_CUSTOM_SUB_MODE_POSCTL_ORBIT  = 1,
    PX4_CUSTOM_SUB_MODE_POSCTL_SLOW   = 2,
};
```

---

## nav_state → custom_mode 映射

`px4_custom_mode.h` 中定义的 `get_px4_custom_mode(nav_state)` 函数：

| nav_state | main_mode | sub_mode | QGC 模式名称 |
|-----------|-----------|----------|-------------|
| `NAVIGATION_STATE_MANUAL` (0) | MANUAL (1) | — | Manual |
| `NAVIGATION_STATE_ALTCTL` (1) | ALTCTL (2) | — | Altitude |
| `NAVIGATION_STATE_POSCTL` (2) | POSCTL (3) | POSCTL (0) | Position |
| `NAVIGATION_STATE_AUTO_MISSION` (3) | AUTO (4) | MISSION (4) | Mission |
| `NAVIGATION_STATE_AUTO_LOITER` (4) | AUTO (4) | LOITER (3) | Hold |
| `NAVIGATION_STATE_AUTO_RTL` (5) | AUTO (4) | RTL (5) | Return |
| `NAVIGATION_STATE_POSITION_SLOW` (6) | POSCTL (3) | SLOW (2) | — |
| `NAVIGATION_STATE_ALTITUDE_CRUISE` (8) | ALTITUDE_CRUISE (11) | — | — |
| `NAVIGATION_STATE_ACRO` (10) | ACRO (5) | — | Acro |
| `NAVIGATION_STATE_DESCEND` (12) | AUTO (4) | LAND (6) | Land |
| `NAVIGATION_STATE_TERMINATION` (13) | TERMINATION (10) | — | — |
| `NAVIGATION_STATE_OFFBOARD` (14) | OFFBOARD (6) | — | Offboard |
| `NAVIGATION_STATE_STAB` (15) | STABILIZED (7) | — | Stabilized |
| `NAVIGATION_STATE_AUTO_TAKEOFF` (17) | AUTO (4) | TAKEOFF (2) | Takeoff |
| `NAVIGATION_STATE_AUTO_LAND` (18) | AUTO (4) | LAND (6) | Land |
| `NAVIGATION_STATE_AUTO_FOLLOW_TARGET` (19) | AUTO (4) | FOLLOW_TARGET (8) | Follow Me |
| `NAVIGATION_STATE_AUTO_PRECLAND` (20) | AUTO (4) | PRECLAND (9) | Precision Land |
| `NAVIGATION_STATE_ORBIT` (21) | POSCTL (3) | ORBIT (1) | Orbit |
| `NAVIGATION_STATE_AUTO_VTOL_TAKEOFF` (22) | AUTO (4) | VTOL_TAKEOFF (10) | — |
| `NAVIGATION_STATE_EXTERNAL1` (23) | AUTO (4) | EXTERNAL1 (11) | — |
| ... | | | |
| `NAVIGATION_STATE_EXTERNAL8` (30) | AUTO (4) | EXTERNAL8 (18) | — |

---

## VehicleStatus.msg 关键字段

```cpp
uint8 arming_state
  ARMING_STATE_DISARMED = 1
  ARMING_STATE_ARMED    = 2

uint8 nav_state                    # 当前导航状态（见上表）
uint8 nav_state_user_intention     # 用户意图的模式（故障保护时可能与 nav_state 不同）
uint8 nav_state_display            # 用户可见的 nav_state（发送到 MAVLink）

uint32 valid_nav_states_mask       # 所有有效 nav_state 的位掩码
uint32 can_set_nav_states_mask     # 用户可手动设置的模式位掩码

bool failsafe                      # 系统处于故障保护状态
bool failsafe_and_user_took_over   # 故障保护但用户已接管

uint8 vehicle_type                 # 载具类型
  VEHICLE_TYPE_UNSPECIFIED = 0
  VEHICLE_TYPE_ROTARY_WING = 1
  VEHICLE_TYPE_FIXED_WING  = 2
  VEHICLE_TYPE_ROVER       = 3

bool pre_flight_checks_pass        # 预飞检查通过

# MAVLink 识别
uint8 system_type                  # MAV_TYPE
uint8 system_id                    # MAVLink system ID
uint8 component_id                 # MAVLink component ID
```

### 武装状态机

```cpp
enum class ARMING_STATE {
    DISARMED = 1,
    ARMED    = 2,
};
```

PX4 在 `Commander.cpp` 中处理 `MAV_CMD_COMPONENT_ARM_DISARM`：
- param1 = 1 → 请求武装
- param1 = 0 → 请求解除武装
- param2 = 21196 → 紧急停止（强制解除）

---

## HEARTBEAT 消息生成

PX4 的 MAVLink 模块从 `VehicleStatus` uORB topic 生成 HEARTBEAT：

```cpp
// 简化逻辑（src/modules/mavlink/mavlink_messages.cpp 附近）
mavlink_heartbeat_t heartbeat;
heartbeat.type        = vehicle_status.system_type;        // MAV_TYPE
heartbeat.autopilot   = MAV_AUTOPILOT_PX4;
heartbeat.base_mode   = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED; // 始终启用 custom mode
if (vehicle_status.arming_state == ARMING_STATE_ARMED) {
    heartbeat.base_mode |= MAV_MODE_FLAG_SAFETY_ARMED;
}
heartbeat.custom_mode = get_px4_custom_mode(vehicle_status.nav_state).data;
heartbeat.system_status = MAV_STATE_ACTIVE; // 或 STANDBY / CRITICAL / EMERGENCY
```

---

## 模式切换命令处理

### MAV_CMD_DO_SET_MODE

`src/modules/mavlink/mavlink_receiver.cpp` 中处理：

```cpp
// 简化逻辑
void MavlinkReceiver::handle_message_command_long(const mavlink_message_t *msg)
{
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(msg, &cmd);

    if (cmd.command == MAV_CMD_DO_SET_MODE) {
        uint8_t base_mode = cmd.param1;
        uint32_t custom_mode = cmd.param2;

        if (base_mode & MAV_MODE_FLAG_CUSTOM_MODE_ENABLED) {
            union px4_custom_mode px4_mode;
            px4_mode.data = custom_mode;

            // 查找对应的 nav_state
            // 发布 vehicle_command uORB topic
            // Commander 订阅并执行模式切换
        }
    }
}
```

---

## 无人车/船（Rover/Boat）的特殊性

PX4 中 boat (MAV_TYPE=11) 映射为 `VEHICLE_TYPE_ROVER`：

```cpp
// 在 Commander 或 land_detector 中
bool is_ground_vehicle() {
    return vehicle_type == VEHICLE_TYPE_ROVER;
}
```

**关键差异**：
1. **着陆检测**：无人车/船始终认为 "已着陆"（`is_ground_vehicle() = true`）
2. **允许地面武装**：无人车可以在未起飞状态下武装
3. **手动模式**：使用 `rover_pos_control` 而非 `mc_pos_control`
4. **返航高度**：无人车返航不涉及高度变化

---

## MavDeck 实现要点

### PX4 模式解码器

```typescript
// src/mavlink/px4-mode-decoder.ts

interface Px4ModeInfo {
  mainMode: number;
  subMode: number;
  navState: number;
  modeName: string;
}

// 从 HEARTBEAT.custom_mode 解码
export function decodePx4CustomMode(customMode: number): Px4ModeInfo {
  const mainMode = (customMode >> 16) & 0xFF;
  const subMode = customMode & 0xFF;
  // 或者按 QGC 的方式：直接用 customMode 查表
  return {
    mainMode,
    subMode,
    navState: navStateFromCustomMode(customMode),
    modeName: PX4_MODE_NAME_MAP[customMode] || 'Unknown',
  };
}

// 完整的 QGC 兼容映射表
const PX4_MODE_NAME_MAP: Record<number, string> = {
  0x00010000: 'Manual',
  0x00070000: 'Stabilized',
  0x00050000: 'Acro',
  0x00080000: 'Rattitude',
  0x00020000: 'Altitude',
  0x00060000: 'Offboard',
  0x00090000: 'Simple',
  0x03000000: 'Position',
  0x03010000: 'Orbit',
  0x04030000: 'Hold',
  0x04040000: 'Mission',
  0x04050000: 'Return',
  0x04060000: 'Land',
  0x04080000: 'Precision Land',
  0x04010000: 'Ready',
  0x04070000: 'Return to Groundstation',
  0x04020000: 'Takeoff',
};
```

### Armed 状态提取

```typescript
export function isArmed(baseMode: number): boolean {
  return (baseMode & 0x80) !== 0;  // MAV_MODE_FLAG_SAFETY_ARMED = 0x80
}
```

---

## 相关源码位置速查

```
PX4-Autopilot-main/
  src/modules/commander/
    px4_custom_mode.h           # custom_mode 编码定义（第44-97行）
    Commander.cpp               # 武装/模式切换状态机
    Commander.hpp               # 类定义
    HealthAndArmingChecks/      # 预飞检查
      HealthAndArmingChecks.cpp
      checks/                   # 各类检查实现
  msg/versioned/
    VehicleStatus.msg           # nav_state 枚举、武装状态（第32-125行）
    CommanderStatus.msg         # Commander 状态
  src/modules/mavlink/
    mavlink_messages.cpp        # HEARTBEAT 生成
    mavlink_receiver.cpp        # 命令接收处理
```
