# QGC 飞行器命令发送详解

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/Vehicle/Vehicle.cc` | `sendMavCommand`, `setArmed`, 命令 ACK 处理 |
| `src/Vehicle/Vehicle.h` | 命令相关接口声明 |
| `src/FirmwarePlugin/PX4/PX4FirmwarePlugin.cc` | PX4 特定的引导动作实现 |
| `src/FirmwarePlugin/FirmwarePlugin.cc` | 基类默认实现（`_setFlightModeAndValidate`, `_armVehicleAndValidate`） |

---

## 命令发送基础设施

### Vehicle::sendMavCommand

```cpp
void Vehicle::sendMavCommand(
    int componentId,
    MAV_CMD command,
    bool showError,
    double param1, double param2, double param3,
    double param4, double param5, double param6, double param7)
```

**参数说明**：
- `componentId`: 目标组件 ID，通常 `defaultComponentId()`（飞控主组件）
- `command`: `MAV_CMD_*` 枚举值
- `showError`: 若命令失败，是否向用户显示错误提示
- `param1-7`: 命令参数

**内部流程**：
1. 构建 `mavlink_command_long_t` 或 `mavlink_command_int_t`
2. 分配命令 ID（用于匹配 ACK）
3. 通过当前链路发送
4. 启动重试定时器（默认重试 3 次，间隔 3 秒）
5. 等待 `MAVLinkMsgIdCommandAck`（COMMAND_ACK）

### Vehicle::sendMavCommandInt

用于需要高精度经纬度的命令（如 `MAV_CMD_DO_REPOSITION`）：

```cpp
void Vehicle::sendMavCommandInt(
    int componentId,
    MAV_CMD command,
    MAV_FRAME frame,
    bool showError,
    double param1, double param2, double param3, double param4,
    int32_t param5, int32_t param6, float param7)
```

- `param5`, `param6` 为 `int32_t` 类型（1e7 度，即厘米级精度经纬度）

---

## 武装 / 解除武装

### Vehicle::setArmed

```cpp
void Vehicle::setArmed(bool armed)
{
    sendMavCommand(
        defaultComponentId(),
        MAV_CMD_COMPONENT_ARM_DISARM,
        true,    // show error
        armed ? 1.0 : 0.0,   // param1: 1=arm, 0=disarm
        0, 0, 0, 0, 0, 0);   // param2-7 unused
}
```

**强制解除武装**（紧急停止）：

```cpp
void Vehicle::setEmergencyStop(bool emergencyStop)
{
    sendMavCommand(
        defaultComponentId(),
        MAV_CMD_COMPONENT_ARM_DISARM,
        true,
        0.0,    // disarm
        21196); // param2: emergency stop magic number
}
```

### 基类辅助方法

```cpp
// FirmwarePlugin.cc
bool FirmwarePlugin::_armVehicleAndValidate(Vehicle* vehicle)
{
    if (vehicle->armed()) {
        return true;
    }
    vehicle->setArmedShowError(true);
    // 等待武装确认...
}

bool FirmwarePlugin::_setFlightModeAndValidate(Vehicle* vehicle, const QString& flightMode)
{
    uint8_t baseMode;
    uint32_t customMode;
    if (setFlightMode(flightMode, &baseMode, &customMode)) {
        vehicle->setFlightMode(baseMode, customMode);
        // 等待模式切换确认...
    }
}
```

---

## 模式切换命令

### Vehicle::setFlightMode

```cpp
void Vehicle::setFlightMode(uint8_t baseMode, uint32_t customMode)
{
    sendMavCommand(
        defaultComponentId(),
        MAV_CMD_DO_SET_MODE,
        true,                           // show error
        baseMode,                       // param1: MAV_MODE_FLAG
        customMode,                     // param2: custom mode
        0, 0, 0, 0, 0);                 // param3-7 unused
}
```

**PX4 典型调用**：

```cpp
// PX4FirmwarePlugin.cc 中设置 Return 模式
void PX4FirmwarePlugin::guidedModeRTL(Vehicle* vehicle, bool smartRTL) const
{
    _setFlightModeAndValidate(vehicle, rtlFlightMode());
    // rtlFlightMode() 返回 "Return"
    // setFlightMode("Return") → base_mode=0x80, custom_mode=0x04050000
}
```

---

## 引导动作（Guided Actions）

### PX4 的引导动作实现

#### Pause（暂停 → Hold 模式）

```cpp
void PX4FirmwarePlugin::pauseVehicle(Vehicle* vehicle) const
{
    vehicle->sendMavCommand(
        vehicle->defaultComponentId(),
        MAV_CMD_DO_REPOSITION,
        true,                                   // show error if failed
        -1.0f,                                  // param1: -1 = 保持当前空速
        MAV_DO_REPOSITION_FLAGS_CHANGE_MODE,    // param2: 0x01 = 切换模式
        0.0f,                                   // param3: reserved
        NAN, NAN, NAN, NAN);                    // param4-7: 不变
}
```

#### Goto Location

```cpp
bool PX4FirmwarePlugin::guidedModeGotoLocation(
    Vehicle* vehicle, const QGeoCoordinate& gotoCoord, double forwardFlightLoiterRadius) const
{
    // 优先使用 COMMAND_INT（高精度经纬度）
    if (vehicle->capabilityBits() & MAV_PROTOCOL_CAPABILITY_COMMAND_INT) {
        vehicle->sendMavCommandInt(
            vehicle->defaultComponentId(),
            MAV_CMD_DO_REPOSITION,
            MAV_FRAME_GLOBAL,
            true,                                   // show error
            -1.0f,                                  // param1
            MAV_DO_REPOSITION_FLAGS_CHANGE_MODE,    // param2
            0.0f, NAN,                              // param3-4
            gotoCoord.latitude() * 1e7,             // param5: lat (int32, 1e7 deg)
            gotoCoord.longitude() * 1e7,            // param6: lon (int32, 1e7 deg)
            vehicle->altitudeAMSL()->rawValue().toFloat()); // param7: AMSL alt
    } else {
        // fallback 到 COMMAND_LONG（float 经纬度，精度较低）
        vehicle->sendMavCommand(...);
    }
}
```

#### Takeoff

```cpp
void PX4FirmwarePlugin::guidedModeTakeoff(Vehicle* vehicle, double takeoffAltRel) const
{
    double vehicleAltitudeAMSL = vehicle->altitudeAMSL()->rawValue().toDouble();
    double takeoffAltAMSL = takeoffAltRel + vehicleAltitudeAMSL;

    // 连接命令结果回调：起飞命令被接受后自动武装
    connect(vehicle, &Vehicle::mavCommandResult, this, &PX4FirmwarePlugin::_mavCommandResult);
    
    vehicle->sendMavCommand(
        vehicle->defaultComponentId(),
        MAV_CMD_NAV_TAKEOFF,
        true,                                   // show error
        -1,                                     // param1: pitch (NaN/ignored)
        0, 0,                                   // param2-3 unused
        NAN, NAN, NAN,                          // param4-6: no yaw, lat, lon
        static_cast<float>(takeoffAltAMSL));   // param7: AMSL altitude
}

void PX4FirmwarePlugin::_mavCommandResult(int vehicleId, int component, int command, 
                                           int result, int failureCode)
{
    if (command == MAV_CMD_NAV_TAKEOFF && result == MAV_RESULT_ACCEPTED) {
        disconnect(vehicle, &Vehicle::mavCommandResult, this, &PX4FirmwarePlugin::_mavCommandResult);
        if (!vehicle->armed()) {
            vehicle->setArmedShowError(true);
        }
    }
}
```

**PX4 Takeoff 流程**：
1. GCS 发送 `MAV_CMD_NAV_TAKEOFF`（PX4 进入 AUTO_TAKEOFF 模式）
2. PX4 接受后返回 `MAV_RESULT_ACCEPTED`
3. QGC 收到 ACK 后发送 `MAV_CMD_COMPONENT_ARM_DISARM`（param1=1）
4. 飞行器武装并执行起飞

#### Land

```cpp
void PX4FirmwarePlugin::guidedModeLand(Vehicle* vehicle) const
{
    _setFlightModeAndValidate(vehicle, landFlightMode());
    // landFlightMode() → "Land" → AUTO_LAND (0x04060000)
}
```

#### RTL (Return to Launch)

```cpp
void PX4FirmwarePlugin::guidedModeRTL(Vehicle* vehicle, bool smartRTL) const
{
    _setFlightModeAndValidate(vehicle, rtlFlightMode());
    // rtlFlightMode() → "Return" → AUTO_RTL (0x04050000)
}
```

#### Change Altitude

```cpp
void PX4FirmwarePlugin::guidedModeChangeAltitude(Vehicle* vehicle, double altitudeChange, bool pauseVehicle)
{
    double currentAltRel = vehicle->altitudeRelative()->rawValue().toDouble();
    double newAltRel = currentAltRel + altitudeChange;
    double newAMSLAlt = vehicle->homePosition().altitude() + newAltRel;

    if (pauseVehicle) {
        // 先暂停（DO_REPOSITION 到当前位置），成功后改高度
        // 使用回调链：sendMavCommandWithHandler → _pauseVehicleThenChangeAltResultHandler
        // → _changeAltAfterPause → 再次 DO_REPOSITION 只改高度
    } else {
        // 直接发送改高度命令
        vehicle->sendMavCommand(..., MAV_CMD_DO_REPOSITION, ..., newAMSLAlt);
    }
}
```

---

## 命令 ACK 处理

### COMMAND_ACK 消息结构

```cpp
mavlink_command_ack_t {
    uint16_t command;    // 被确认的命令 ID
    uint8_t  result;     // MAV_RESULT 枚举
    uint8_t  progress;   // 进度（某些命令）
    int32_t  result_param2;
    uint8_t  target_system;
    uint8_t  target_component;
}
```

### MAV_RESULT 枚举值

| 值 | 名称 | 含义 |
|----|------|------|
| 0 | `MAV_RESULT_ACCEPTED` | 命令已接受并执行 |
| 1 | `MAV_RESULT_TEMPORARILY_REJECTED` | 暂时拒绝（如正在执行其他命令）|
| 2 | `MAV_RESULT_DENIED` | 拒绝执行 |
| 3 | `MAV_RESULT_UNSUPPORTED` | 不支持的命令 |
| 4 | `MAV_RESULT_FAILED` | 执行失败 |
| 5 | `MAV_RESULT_IN_PROGRESS` | 正在执行中（异步命令）|
| 6 | `MAV_RESULT_CANCELLED` | 已取消 |

### QGC 的重试机制

`Vehicle.cc` 中：
- 每条命令分配唯一 ID
- 启动 3 秒超时定时器
- 超时后自动重发（最多重试次数可配置）
- 收到 ACK 后取消定时器
- 若 `showError=true` 且结果非 ACCEPTED，显示错误弹窗

---

## MavDeck 实现要点

MavDeck 已具备命令发送基础：

```typescript
// src/workers/worker-controller.ts 中已有
sendMavlinkMessage(name: string, fields: Record<string, unknown>)

// 发送 ARM 命令示例
workerBridge.sendMavlinkMessage('COMMAND_LONG', {
  target_system: 1,
  target_component: 1,
  command: 400, // MAV_CMD_COMPONENT_ARM_DISARM
  confirmation: 0,
  param1: 1,    // 1=arm, 0=disarm
  param2: 0,
  param3: 0,
  param4: 0,
  param5: 0,
  param6: 0,
  param7: 0,
});
```

**需要新增**：
1. `COMMAND_ACK` 解析和超时/重试逻辑
2. 命令状态跟踪（pending → accepted/rejected）
3. UI 层的命令确认反馈（spinner、成功/失败提示）

---

## 关键 MAVLink 命令速查表

| 命令 | ID | 用途 | 关键参数 |
|------|-----|------|---------|
| `MAV_CMD_COMPONENT_ARM_DISARM` | 400 | 武装/解除 | param1: 0/1, param2: 21196(紧急停止) |
| `MAV_CMD_DO_SET_MODE` | 176 | 设置飞行模式 | param1: base_mode, param2: custom_mode |
| `MAV_CMD_NAV_TAKEOFF` | 22 | 起飞 | param7: AMSL 高度 |
| `MAV_CMD_NAV_LAND` | 21 | 降落 | param4: yaw, param5/6: lat/lon |
| `MAV_CMD_NAV_RETURN_TO_LAUNCH` | 20 | 返航 | 无参数 |
| `MAV_CMD_DO_REPOSITION` | 192 | 重定位/引导 | param2: flags, param5/6/7: lat/lon/alt |
| `MAV_CMD_DO_CHANGE_SPEED` | 178 | 改速度 | param1: type, param2: speed |
| `MAV_CMD_DO_SET_MISSION_CURRENT` | 224 | 跳转到指定 mission 项 | param1: seq |

---

## 相关源码位置速查

```
qgroundcontrol-master/
  src/Vehicle/
    Vehicle.cc        # sendMavCommand (搜索 "sendMavCommand"), setArmed (~第 2800 行附近)
    Vehicle.h         # 命令接口声明
  src/FirmwarePlugin/
    FirmwarePlugin.cc # _setFlightModeAndValidate, _armVehicleAndValidate
    FirmwarePlugin.h  # 虚函数声明
    PX4/
      PX4FirmwarePlugin.cc  # guidedModeTakeoff, guidedModeRTL, guidedModeLand,
                              # pauseVehicle, guidedModeGotoLocation (第 258-570 行)
```
