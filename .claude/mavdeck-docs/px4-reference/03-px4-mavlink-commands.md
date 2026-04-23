# PX4 MAVLink 命令处理详解

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/modules/mavlink/mavlink_receiver.cpp` | 接收并处理来自 GCS 的 MAVLink 命令 |
| `src/modules/mavlink/mavlink_messages.cpp` | 生成并发送 MAVLink 消息到 GCS |
| `src/modules/commander/Commander.cpp` | 武装状态机、模式切换执行 |
| `src/modules/commander/Commander.hpp` | Commander 类定义 |
| `src/modules/commander/failsafe/` | 故障保护逻辑 |

---

## 命令接收流程

### mavlink_receiver.cpp

`MavlinkReceiver` 类处理所有来自 GCS 的 MAVLink 消息：

```cpp
void MavlinkReceiver::handle_message(mavlink_message_t *msg)
{
    switch (msg->msgid) {
    case MAVLINK_MSG_ID_COMMAND_LONG:
        handle_message_command_long(msg);
        break;
    case MAVLINK_MSG_ID_COMMAND_INT:
        handle_message_command_int(msg);
        break;
    case MAVLINK_MSG_ID_SET_MODE:
        handle_message_set_mode(msg);
        break;
    // ... 其他消息类型
    }
}
```

### COMMAND_LONG 处理

```cpp
void MavlinkReceiver::handle_message_command_long(mavlink_message_t *msg)
{
    mavlink_command_long_t cmd;
    mavlink_msg_command_long_decode(msg, &cmd);

    vehicle_command_s vcmd{};
    vcmd.param1 = cmd.param1;
    vcmd.param2 = cmd.param2;
    // ... param3-7
    vcmd.command = cmd.command;
    vcmd.target_system = cmd.target_system;
    vcmd.target_component = cmd.target_component;
    vcmd.source_system = msg->sysid;
    vcmd.source_component = msg->compid;
    vcmd.confirmation = cmd.confirmation;
    vcmd.from_external = true;

    // 发布到 uORB topic: vehicle_command
    _vehicle_command_pub.publish(vcmd);
}
```

**关键转换**：MAVLink `COMMAND_LONG` → uORB `vehicle_command` topic → Commander 订阅处理

---

## Commander 命令处理

### Commander.cpp 主循环

```cpp
void Commander::run()
{
    while (!should_exit()) {
        // 1. 检查 uORB 订阅
        if (_vehicle_command_sub.updated()) {
            vehicle_command_s cmd;
            _vehicle_command_sub.copy(&cmd);
            handle_command(cmd);
        }

        // 2. 更新状态机
        updateParams();
        updateFailsafe();
        updateArmingStatus();

        // 3. 发布状态
        publish_vehicle_status();

        // 4. 睡眠等待
        px4_usleep(COMMANDER_LOOP_INTERVAL);
    }
}
```

### 武装命令处理

```cpp
bool Commander::handle_command(const vehicle_command_s &cmd)
{
    switch (cmd.command) {
    case vehicle_command_s::VEHICLE_CMD_COMPONENT_ARM_DISARM:
        return handle_command_arm_disarm(cmd);
    case vehicle_command_s::VEHICLE_CMD_DO_SET_MODE:
        return handle_command_set_mode(cmd);
    case vehicle_command_s::VEHICLE_CMD_NAV_TAKEOFF:
        return handle_command_takeoff(cmd);
    case vehicle_command_s::VEHICLE_CMD_NAV_LAND:
        return handle_command_land(cmd);
    case vehicle_command_s::VEHICLE_CMD_NAV_RETURN_TO_LAUNCH:
        return handle_command_rtl(cmd);
    case vehicle_command_s::VEHICLE_CMD_DO_REPOSITION:
        return handle_command_reposition(cmd);
    // ... 更多命令
    }
}
```

### MAV_CMD_COMPONENT_ARM_DISARM 处理

```cpp
bool Commander::handle_command_arm_disarm(const vehicle_command_s &cmd)
{
    const int cmd_arm_disarm_value = round(cmd.param1);
    const int cmd_force = round(cmd.param2);

    if (cmd_arm_disarm_value == 1) {
        // 请求武装
        if (cmd_force == 2989) {
            // 强制武装（绕过部分检查）
            arm(ForceDisarm::FORCE_TRUE);
        } else {
            arm(ForceDisarm::FORCE_FALSE);
        }
    } else if (cmd_arm_disarm_value == 0) {
        // 请求解除武装
        if (cmd_force == 21196) {
            // 紧急停止
            disarm(ForceDisarm::FORCE_TRUE, DisarmReason::EMERGENCY_STOP);
        } else {
            disarm(ForceDisarm::FORCE_FALSE, DisarmReason::COMMAND);
        }
    }

    // 发送 COMMAND_ACK
    send_command_ack(cmd.command, MAV_RESULT_ACCEPTED);
    return true;
}
```

### MAV_CMD_DO_SET_MODE 处理

```cpp
bool Commander::handle_command_set_mode(const vehicle_command_s &cmd)
{
    uint8_t base_mode = cmd.param1;
    uint32_t custom_mode = cmd.param2;

    if (base_mode & MAV_MODE_FLAG_CUSTOM_MODE_ENABLED) {
        union px4_custom_mode px4_mode;
        px4_mode.data = custom_mode;

        // 查找对应的 nav_state
        uint8_t nav_state = NAVIGATION_STATE_MAX;

        // 根据 main_mode 和 sub_mode 确定 nav_state
        switch (px4_mode.main_mode) {
        case PX4_CUSTOM_MAIN_MODE_MANUAL:
            nav_state = NAVIGATION_STATE_MANUAL;
            break;
        case PX4_CUSTOM_MAIN_MODE_ALTCTL:
            nav_state = NAVIGATION_STATE_ALTCTL;
            break;
        case PX4_CUSTOM_MAIN_MODE_POSCTL:
            if (px4_mode.sub_mode == PX4_CUSTOM_SUB_MODE_POSCTL_ORBIT) {
                nav_state = NAVIGATION_STATE_ORBIT;
            } else {
                nav_state = NAVIGATION_STATE_POSCTL;
            }
            break;
        case PX4_CUSTOM_MAIN_MODE_AUTO:
            // 根据 sub_mode 选择具体的 auto 模式
            switch (px4_mode.sub_mode) {
            case PX4_CUSTOM_SUB_MODE_AUTO_MISSION:
                nav_state = NAVIGATION_STATE_AUTO_MISSION;
                break;
            case PX4_CUSTOM_SUB_MODE_AUTO_LOITER:
                nav_state = NAVIGATION_STATE_AUTO_LOITER;
                break;
            case PX4_CUSTOM_SUB_MODE_AUTO_RTL:
                nav_state = NAVIGATION_STATE_AUTO_RTL;
                break;
            case PX4_CUSTOM_SUB_MODE_AUTO_TAKEOFF:
                nav_state = NAVIGATION_STATE_AUTO_TAKEOFF;
                break;
            case PX4_CUSTOM_SUB_MODE_AUTO_LAND:
                nav_state = NAVIGATION_STATE_AUTO_LAND;
                break;
            // ... 更多子模式
            }
            break;
        // ... 更多主模式
        }

        if (nav_state != NAVIGATION_STATE_MAX) {
            // 设置用户意图模式
            _user_intended_mode = nav_state;
            // 尝试切换模式
            if (try_mode_change(nav_state)) {
                send_command_ack(cmd.command, MAV_RESULT_ACCEPTED);
            } else {
                send_command_ack(cmd.command, MAV_RESULT_DENIED);
            }
        }
    }

    return true;
}
```

---

## 故障保护（Failsafe）

### 故障保护类型

| 故障保护 | 触发条件 | 默认动作 |
|---------|---------|---------|
| RC Loss | 遥控器信号丢失 | RTL / Hold / Land |
| Data Link Loss | GCS 连接丢失 | RTL / Hold / Land |
| Low Battery | 电量低 | RTL / Land |
| Geofence Breach | 超出围栏 | RTL / Hold / Land |
| Mission Failure | 任务失败 | RTL / Hold |
| Maximum Distance | 超出最大距离 | RTL / Hold |

### 故障保护配置参数

```
NAV_RCL_ACT      — RC 丢失动作
NAV_DLL_ACT      — 数据链丢失动作
BAT_LOW_THR      — 低电量阈值
BAT_CRIT_THR     — 临界电量阈值
GF_ACTION        — 围栏越界动作
COM_DL_LOSS_T    — 数据链丢失超时时间
```

---

## COMMAND_ACK 发送

PX4 在 `mavlink_messages.cpp` 的 `StreamCommandLong` 或 `MavlinkReceiver` 中发送 ACK：

```cpp
void MavlinkReceiver::send_command_ack(uint16_t command, uint8_t result,
                                        uint8_t target_system, uint8_t target_component)
{
    mavlink_command_ack_t ack{};
    ack.command = command;
    ack.result = result;
    ack.target_system = target_system;
    ack.target_component = target_component;

    mavlink_msg_command_ack_send_struct(_mavlink->get_channel(), &ack);
}
```

---

## MavDeck 实现要点

### 命令发送确认机制

MavDeck 需要实现：

1. **命令队列**：发送命令后记录 command ID + 时间戳
2. **ACK 监听**：解析 `COMMAND_ACK`，匹配 command ID
3. **超时重试**：3 秒超时，最多重试 3 次
4. **结果反馈**：
   - `MAV_RESULT_ACCEPTED` → 成功
   - `MAV_RESULT_DENIED` → 被拒绝（如未通过预飞检查）
   - `MAV_RESULT_TEMPORARILY_REJECTED` → 暂时拒绝
   - 超时 → 重试或报错

### 发送模式切换

```typescript
// 发送 DO_SET_MODE 到 PX4
workerBridge.sendMavlinkMessage('COMMAND_LONG', {
  target_system: 1,
  target_component: 1,
  command: 176, // MAV_CMD_DO_SET_MODE
  confirmation: 0,
  param1: 0x80 | 0x40, // CUSTOM_MODE_ENABLED | SAFETY_ARMED (如果已武装)
  param2: customMode,  // uint32 custom_mode
  param3: 0, param4: 0, param5: 0, param6: 0, param7: 0,
});
```

### 发送武装命令

```typescript
workerBridge.sendMavlinkMessage('COMMAND_LONG', {
  target_system: 1,
  target_component: 1,
  command: 400, // MAV_CMD_COMPONENT_ARM_DISARM
  confirmation: 0,
  param1: 1,    // 1 = arm, 0 = disarm
  param2: 0,    // 0 = normal, 21196 = emergency stop
  param3: 0, param4: 0, param5: 0, param6: 0, param7: 0,
});
```

---

## 关键 MAVLink 命令速查表

| 命令 | ID | 处理位置 | 说明 |
|------|-----|---------|------|
| `MAV_CMD_COMPONENT_ARM_DISARM` | 400 | `Commander::handle_command_arm_disarm()` | 武装/解除 |
| `MAV_CMD_DO_SET_MODE` | 176 | `Commander::handle_command_set_mode()` | 模式切换 |
| `MAV_CMD_NAV_TAKEOFF` | 22 | `Commander::handle_command_takeoff()` | 起飞 |
| `MAV_CMD_NAV_LAND` | 21 | `Commander::handle_command_land()` | 降落 |
| `MAV_CMD_NAV_RETURN_TO_LAUNCH` | 20 | `Commander::handle_command_rtl()` | 返航 |
| `MAV_CMD_DO_REPOSITION` | 192 | `Commander::handle_command_reposition()` | 重定位 |
| `MAV_CMD_DO_CHANGE_SPEED` | 178 | Navigator / Commander | 改速度 |
| `MAV_CMD_DO_JUMP` | 177 | Navigator | Mission 跳转 |
| `MAV_CMD_DO_SET_MISSION_CURRENT` | 224 | Mission 模块 | 跳转 mission 项 |

---

## 相关源码位置速查

```
PX4-Autopilot-main/
  src/modules/mavlink/
    mavlink_receiver.cpp        # 命令接收（搜索 handle_message_command_long）
    mavlink_messages.cpp        # 消息生成（搜索 mavlink_msg_heartbeat_send）
    mavlink_main.cpp            # 模块主循环
  src/modules/commander/
    Commander.cpp               # 命令处理核心（搜索 handle_command）
    Commander.hpp               # 类定义
    failsafe/                   # 故障保护逻辑
      failsafe.cpp
      checks.hpp
  src/modules/navigator/
    navigator_main.cpp          # 导航主循环
    mission.cpp                 # Mission 执行
    rtl.cpp                     # RTL 执行
    land.cpp                    # Land 执行
```
