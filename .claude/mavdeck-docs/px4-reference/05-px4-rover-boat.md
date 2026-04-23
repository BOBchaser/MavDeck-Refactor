# PX4 无人车/船（Rover/Boat）特定内容

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/modules/rover_ackermann/` | 阿克曼转向无人车控制 |
| `src/modules/rover_differential/` | 差速转向无人车控制 |
| `src/modules/rover_mecanum/` | 麦克纳姆轮无人车控制 |
| `src/modules/uuv_pos_control/` | 水下航行器位置控制 |
| `src/modules/uuv_att_control/` | 水下航行器姿态控制 |
| `src/modules/land_detector/LandDetector.cpp` | 着陆检测（无人车特殊处理） |
| `msg/versioned/VehicleStatus.msg` | vehicle_type 字段 |
| `ROMFS/px4fmu_common/init.d/airframes/` | 机架配置文件 |

---

## 载具类型映射

PX4 内部使用 `vehicle_type` 区分载具类型：

```cpp
// msg/versioned/VehicleStatus.msg
uint8 vehicle_type
uint8 VEHICLE_TYPE_UNSPECIFIED = 0
uint8 VEHICLE_TYPE_ROTARY_WING = 1   // 多旋翼
uint8 VEHICLE_TYPE_FIXED_WING  = 2   // 固定翼
uint8 VEHICLE_TYPE_ROVER       = 3   // 无人车/船
```

**MAV_TYPE 映射**（MAVLink 层）：

| MAV_TYPE | 值 | PX4 vehicle_type | 说明 |
|----------|-----|-----------------|------|
| `MAV_TYPE_GENERIC` | 0 | UNSPECIFIED | 通用 |
| `MAV_TYPE_FIXED_WING` | 1 | FIXED_WING | 固定翼 |
| `MAV_TYPE_QUADROTOR` | 2 | ROTARY_WING | 四旋翼 |
| `MAV_TYPE_GROUND_ROVER` | 10 | ROVER | 地面无人车 |
| `MAV_TYPE_SURFACE_BOAT` | 11 | ROVER | 水面无人船 |
| `MAV_TYPE_SUBMARINE` | 12 | — | 潜艇 |

**关键**: MAV_TYPE=11 (boat) 和 MAV_TYPE=10 (rover) 在 PX4 内部都映射为 `VEHICLE_TYPE_ROVER`。

---

## 无人车/船控制模块

### 控制架构

```
Navigator (mission/rtl/loiter)
    ↓
rover_pos_control (位置控制)
    ↓
rover_att_control (姿态控制) — 无人车通常跳过或简化
    ↓
control_allocator (控制分配)
    ↓
actuators (电机/舵机)
```

### 现有控制模块

| 模块 | 路径 | 适用场景 |
|------|------|---------|
| **rover_ackermann** | `src/modules/rover_ackermann/` | 汽车式转向（前轮转向） |
| **rover_differential** | `src/modules/rover_differential/` | 差速转向（履带/坦克式） |
| **rover_mecanum** | `src/modules/rover_mecanum/` | 麦克纳姆轮全向移动 |

### 水下航行器

| 模块 | 路径 | 适用场景 |
|------|------|---------|
| **uuv_pos_control** | `src/modules/uuv_pos_control/` | UUV 位置控制（深度、位置） |
| **uuv_att_control** | `src/modules/uuv_att_control/` | UUV 姿态控制（俯仰、横滚、航向） |

---

## 无人车/船的特殊行为

### 1. 着陆检测

```cpp
// src/modules/land_detector/LandDetector.cpp
bool LandDetector::_get_landed_state()
{
    if (_vehicle_type == VEHICLE_TYPE_ROVER) {
        // 无人车/船始终认为已"着陆"
        return true;
    }
    // 多旋翼/固定翼的着陆检测逻辑...
}
```

**影响**：
- 武装后不需要"起飞"即可移动
- `MAV_CMD_NAV_TAKEOFF` 对无人车/船的行为可能与飞行器不同

### 2. 返航（RTL）

无人车/船的 RTL：
- 不涉及高度变化（保持当前高度或地面高度）
- 直接沿地面路径返回 home 点
- 到达 home 点后可能直接停止（而非降落）

### 3. 手动模式

| 模式 | 无人车行为 |
|------|-----------|
| Manual | 直接控制油门/转向 |
| Acro | 速率控制（横摆速率） |
| Stabilized | 自稳（保持航向） |
| PosCtl | 位置控制（GPS 定点） |
| Auto Mission | 按 mission 路径行驶 |
| Auto RTL | 返航 |
| Auto Hold | 停止并保持位置 |

### 4. 参数差异

无人车/船使用不同的参数集：

```
# 通用
GND_SPEED_MAX      — 最大地面速度
GND_SPEED_MIN      — 最小地面速度
GND_SPEED_THR      — 油门到速度映射

# 阿克曼转向
RA_WHEEL_BASE      — 轴距
RA_MAX_STR_ANG     — 最大转向角

# 差速转向
RD_WHEEL_TRACK     — 轮距
RD_MAX_THR_YAW     — 最大横摆速率
```

---

## 机架配置（Airframe）

### 启动脚本

```
ROMFS/px4fmu_common/init.d/airframes/
  ├── 50000_generic_ground_vehicle      # 通用地面载具
  ├── 50001_axialracing_ax10            # Axial Racing AX10
  ├── 50002_traxxas_stampede_4wd        # Traxxas Stampede
  ├── 50003_aion_robotics_r1_rover      # Aion Robotics R1
  ├── 50004_nxpcup_dfrobot_gpx          # NXP Cup DFRobot GPX
  ├── 50005_mair_rover                  # MAIR Rover
  ├── 50006_grouse                     # Grouse (差速转向)
  └── 50007_ikea_robot                 # IKEA 机器人
```

### SITL 配置

```
ROMFS/px4fmu_common/init.d-posix/airframes/
  ├── 50001_axialracing_ax10
  ├── 50004_nxpcup_dfrobot_gpx
  └── ...
```

---

## 预飞检查（Preflight Checks）

无人车/船的预飞检查与飞行器类似，但某些检查可能不同：

| 检查项 | 飞行器 | 无人车/船 |
|--------|--------|----------|
| 传感器校准 | 罗盘、加速度计、陀螺仪 | 罗盘、加速度计、陀螺仪（可能简化） |
| GPS | 必须 | 必须（用于定位） |
| 电池 | 必须 | 必须 |
| 遥控器 | 必须 | 可选（可用自主模式替代） |
| 空速管 | 固定翼需要 | 不需要 |
| 着陆检测 | 需要 | 始终通过 |

---

## MAVLink 消息差异

### HEARTBEAT

```cpp
mavlink_heartbeat_t heartbeat;
heartbeat.type = MAV_TYPE_SURFACE_BOAT;  // 或 MAV_TYPE_GROUND_ROVER
heartbeat.autopilot = MAV_AUTOPILOT_PX4;
heartbeat.base_mode = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED;
heartbeat.custom_mode = get_px4_custom_mode(nav_state).data;
```

### 扩展状态

```cpp
mavlink_extended_sys_state_t ext_state;
ext_state.landed_state = MAV_LANDED_STATE_ON_GROUND;  // 无人车始终在地面
```

---

## MavDeck 适配要点

### 1. 载具类型检测

```typescript
export function isRoverOrBoat(heartbeatType: number): boolean {
  return heartbeatType === MAV_TYPE_GROUND_ROVER || 
         heartbeatType === MAV_TYPE_SURFACE_BOAT;
}
```

### 2. UI 适配

| UI 元素 | 飞行器 | 无人车/船 |
|---------|--------|----------|
| 人工地平线 | 有用 | 不太有用（可选隐藏） |
| 高度显示 | 绝对/相对高度 | 可简化或隐藏 |
| 速度 | 空速/地速 | 仅地速 |
| Takeoff 按钮 | 有用 | 可改为 "Start Mission" 或隐藏 |
| Land 按钮 | 有用 | 可改为 "Stop" 或隐藏 |
| RTL | 返航并降落 | 返航并停止 |
| 任务高度 | 重要 | 不重要（可固定为 0） |

### 3. 模式映射

无人车/船可用的 PX4 模式：

- Manual
- Acro
- Stabilized
- Altitude（可能不适用）
- Position
- Offboard
- Auto Mission
- Auto RTL
- Auto Hold
- Auto Takeoff（可能跳过）
- Auto Land（可能等同于停止）

---

## 相关源码位置速查

```
PX4-Autopilot-main/
  src/modules/rover_ackermann/
    RoverAckermann.cpp          # 阿克曼控制主循环
    RoverAckermann.hpp
  src/modules/rover_differential/
    RoverDifferential.cpp       # 差速控制主循环
  src/modules/rover_mecanum/
    RoverMecanum.cpp            # 麦克纳姆轮控制
  src/modules/uuv_pos_control/
    UUVPosControl.cpp           # UUV 位置控制
  src/modules/uuv_att_control/
    UUVAttControl.cpp           # UUV 姿态控制
  src/modules/land_detector/
    LandDetector.cpp            # 着陆检测（搜索 VEHICLE_TYPE_ROVER）
  ROMFS/px4fmu_common/init.d/airframes/
    50000_generic_ground_vehicle
    50001_axialracing_ax10
    # ... 其他无人车配置
  ROMFS/px4fmu_common/init.d-posix/airframes/
    # SITL 配置
```
