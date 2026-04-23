# PX4 Mission 协议详解

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/modules/mavlink/mavlink_mission.cpp` | MAVLink Mission 协议实现 |
| `src/modules/navigator/mission.cpp` | Mission 执行逻辑 |
| `src/modules/navigator/navigator_main.cpp` | 导航主循环 |
| `src/modules/dataman/dataman.cpp` | Mission 数据持久化存储 |
| `msg/versioned/MissionResult.msg` | Mission 执行结果 uORB topic |
| `msg/versioned/VehicleMission.msg` | Mission 数据 uORB topic |

---

## MAVLink Mission 协议 v2（PX4 实现）

PX4 通过 `mavlink_mission.cpp` 实现 MAVLink Mission 协议，与 GCS 交换任务数据。

### 核心类

```cpp
class MavlinkMissionManager {
public:
    void handle_message(const mavlink_message_t *msg);
    void send_mission_count();
    void send_mission_item(uint16_t seq);
    void parse_mission_item(const mavlink_mission_item_t *item, ...);
    void format_mission_item(const struct mission_item_s *item, ...);

private:
    enum class MAVLINK_MISSION_STATE {
        IDLE,
        SEND_LIST,
        SEND_ITEM,
        ITEM,
        ACK,
        ABORT
    } _state{MAVLINK_MISSION_STATE::IDLE};

    uint16_t _transfer_seq;       // 当前传输序号
    uint16_t _transfer_count;     // 总传输数量
    int _transfer_partner_sysid;  // 对端 system ID
    int _transfer_partner_compid; // 对端 component ID
};
```

---

## Mission 上传流程（GCS → PX4）

```
GCS                                    PX4
 |                                      |
 |--- MISSION_COUNT (n) -------------->|  mavlink_mission.cpp 收到
 |                                      |  _state = ITEM, _transfer_count = n
 |<-- MISSION_REQUEST_INT (seq=0) -----|  发送请求
 |--- MISSION_ITEM_INT (seq=0) ------>|  解析并存储到 dataman
 |<-- MISSION_REQUEST_INT (seq=1) -----|  请求下一项
 |--- MISSION_ITEM_INT (seq=1) ------>|  ...
 |              ...                     |
 |<-- MISSION_REQUEST_INT (seq=n-1) ---|
 |--- MISSION_ITEM_INT (seq=n-1) ---->|  最后一项
 |<-- MISSION_ACK (ACCEPTED) ---------|  确认完成
```

### PX4 处理逻辑

```cpp
void MavlinkMissionManager::handle_message(const mavlink_message_t *msg)
{
    switch (msg->msgid) {
    case MAVLINK_MSG_ID_MISSION_COUNT:
        handle_mission_count(msg);
        break;
    case MAVLINK_MSG_ID_MISSION_ITEM_INT:
        handle_mission_item(msg);
        break;
    case MAVLINK_MSG_ID_MISSION_REQUEST_LIST:
        handle_mission_request_list(msg);
        break;
    case MAVLINK_MSG_ID_MISSION_REQUEST_INT:
        handle_mission_request_int(msg);
        break;
    case MAVLINK_MSG_ID_MISSION_ACK:
        handle_mission_ack(msg);
        break;
    case MAVLINK_MSG_ID_MISSION_CLEAR_ALL:
        handle_mission_clear_all(msg);
        break;
    }
}
```

---

## Mission 下载流程（PX4 → GCS）

```
GCS                                    PX4
 |                                      |
 |--- MISSION_REQUEST_LIST ---------->|  mavlink_mission.cpp 收到
 |<-- MISSION_COUNT (n) --------------|  发送任务总数
 |--- MISSION_REQUEST_INT (seq=0) -->|  请求第 0 项
 |<-- MISSION_ITEM_INT (seq=0) -------|  从 dataman 读取并发送
 |--- MISSION_REQUEST_INT (seq=1) -->|
 |<-- MISSION_ITEM_INT (seq=1) -------|
 |              ...                     |
 |--- MISSION_REQUEST_INT (seq=n-1) >|
 |<-- MISSION_ITEM_INT (seq=n-1) -----|
 |--- MISSION_ACK (ACCEPTED) ------->|  GCS 确认接收完成
```

---

## Mission 存储

PX4 使用 `dataman` 模块持久化存储 mission 数据：

```cpp
// dataman 存储类型
enum dataman_id {
    DM_KEY_SAFE_POINTS = 0,       // 安全点
    DM_KEY_FENCE_POINTS,          // 围栏点
    DM_KEY_WAYPOINTS_OFFBOARD_0,  // 机载 mission（slot 0）
    DM_KEY_WAYPOINTS_OFFBOARD_1,  // 机载 mission（slot 1）
    DM_KEY_WAYPOINTS_ONBOARD,     // 机载生成 mission
    DM_KEY_MISSION_STATE,         // mission 状态
};
```

**存储位置**：
- 真实硬件：`/fs/microsd/dataman`
- SITL：`build/px4_sitl_default/tmp/rootfs/fs/microsd/dataman`

---

## Mission 项类型

PX4 内部使用 `mission_item_s` 结构：

```cpp
struct mission_item_s {
    double lat;           // 纬度（度）
    double lon;           // 经度（度）
    float altitude;       // 高度（米）
    float acceptance_radius; // 接受半径
    float loiter_radius;  // 悬停半径
    float yaw;            // 航向
    float params[7];      // 命令参数
    uint16_t nav_cmd;     // MAV_CMD
    int16_t do_jump_mission_index; // DO_JUMP 目标
    uint16_t do_jump_repeat_count; // DO_JUMP 重复次数
    uint16_t do_jump_current_count; // 当前重复计数
    bool altitude_is_relative; // 相对高度标志
    bool autocontinue;    // 自动继续
    bool loiter_exit_xtrack; // 从外侧退出悬停
    unsigned origin;      // 来源
};
```

### 支持的 MAV_CMD

| MAV_CMD | 用途 | 说明 |
|---------|------|------|
| `MAV_CMD_NAV_WAYPOINT` | 航点 | param1: hold time |
| `MAV_CMD_NAV_TAKEOFF` | 起飞 | param1: pitch, param7: altitude |
| `MAV_CMD_NAV_LAND` | 降落 | param4: yaw |
| `MAV_CMD_NAV_RETURN_TO_LAUNCH` | 返航 | 无参数 |
| `MAV_CMD_NAV_LOITER_UNLIM` | 无限悬停 | |
| `MAV_CMD_NAV_LOITER_TIME` | 定时悬停 | param1: time |
| `MAV_CMD_NAV_LOITER_TO_ALT` | 高度悬停 | |
| `MAV_CMD_DO_JUMP` | 跳转 | param1: seq, param2: repeat |
| `MAV_CMD_DO_CHANGE_SPEED` | 改速度 | param1: type, param2: speed |
| `MAV_CMD_DO_SET_SERVO` | 设置舵机 | param1: port, param2: pwm |
| `MAV_CMD_DO_SET_ACTUATOR` | 设置执行器 | |
| `MAV_CMD_DO_VTOL_TRANSITION` | VTOL 过渡 | param1: state |
| `MAV_CMD_NAV_VTOL_TAKEOFF` | VTOL 起飞 | |
| `MAV_CMD_NAV_VTOL_LAND` | VTOL 降落 | |
| `MAV_CMD_DO_REPOSITION` | 重定位 | |

---

## Mission 执行

### Navigator 模块

`src/modules/navigator/` 负责 mission 执行：

```cpp
class Navigator : public ModuleBase<Navigator>
{
public:
    void run() override;

private:
    Mission _mission;           // mission 执行器
    Rtl _rtl;                   // RTL 执行器
    Land _land;                 // Land 执行器
    Loiter _loiter;             // Loiter 执行器
    Takeoff _takeoff;           // Takeoff 执行器
    Precland _precland;         // 精准降落

    void on_mission_item_updated();
    void set_mission_failure(const char *reason);
};
```

### 执行流程

```cpp
void Navigator::run()
{
    while (!should_exit()) {
        // 1. 检查参数更新
        parameter_update_poll();

        // 2. 检查 mission 更新
        if (_mission_sub.updated()) {
            _mission_sub.copy(&mission);
            _mission.set_current_mission_index(mission.current_seq);
        }

        // 3. 根据当前模式执行对应导航器
        switch (_vehicle_status.nav_state) {
        case NAVIGATION_STATE_AUTO_MISSION:
            _mission.on_active();
            break;
        case NAVIGATION_STATE_AUTO_RTL:
            _rtl.on_active();
            break;
        case NAVIGATION_STATE_AUTO_LAND:
            _land.on_active();
            break;
        case NAVIGATION_STATE_AUTO_LOITER:
            _loiter.on_active();
            break;
        case NAVIGATION_STATE_AUTO_TAKEOFF:
            _takeoff.on_active();
            break;
        // ...
        }

        // 4. 发布位置设定点
        _pos_sp_triplet_pub.publish(pos_sp_triplet);

        px4_usleep(100000); // 10Hz
    }
}
```

### MISSION_CURRENT 报告

PX4 通过 MAVLink 向 GCS 报告当前 mission 进度：

```cpp
// mavlink_messages.cpp
mavlink_mission_current_t mission_current;
mission_current.seq = _mission.current_seq;
mission_current.total = _mission.count;
mission_current.mission_state = MAV_MISSION_STATE_ACTIVE;
mission_current.mission_mode = MAV_MISSION_TYPE_MISSION;
```

---

## Geofence（地理围栏）

### 围栏类型

| 类型 | 说明 |
|------|------|
| Circular | 以 home 为圆心的圆形围栏 |
| Polygon | 多边形围栏 |
| Altitude | 最大高度限制 |

### 配置参数

```
GF_ACTION        — 围栏动作（0=无, 1=告警, 2=Hold, 3=RTL, 4=Terminate）
GF_MAX_HOR_DIST  — 最大水平距离
GF_MAX_VER_DIST  — 最大垂直距离
GF_SOURCE        — 围栏数据来源（0=参数, 1=Mission）
```

### MAVLink 交互

- `FENCE_POINT` — 围栏点上传/下载
- `FENCE_STATUS` — 围栏状态报告
- `FENCE_BREACH` — 围栏 breach 事件

---

## Rally Point（集结点）

PX4 支持安全点（Safe Points）作为 RTL 目标：

- 存储在 `dataman` 的 `DM_KEY_SAFE_POINTS`
- 可通过 MAVLink 上传/下载
- RTL 时选择最近的安全点

---

## MavDeck 实现要点

MavDeck 需要实现 Mission 协议状态机（参考 QGC 的 `PlanManager` 和 PX4 的 `mavlink_mission.cpp`）：

### 状态机设计

```typescript
enum MissionProtocolState {
  Idle,
  Uploading,     // 正在上传 mission 到飞控
  Downloading,   // 正在从飞控下载 mission
  Clearing,      // 正在清除 mission
}

interface MissionManager {
  state: MissionProtocolState;
  items: MissionItem[];
  currentSeq: number;
  reachedSeq: number;

  upload(items: MissionItem[]): Promise<void>;
  download(): Promise<MissionItem[]>;
  clear(): Promise<void>;
  setCurrent(seq: number): void;
}
```

### 先支持的 Mission 项类型

Phase 4 可先实现：
- Takeoff
- Waypoint
- RTL
- Land

后续扩展：
- Loiter
- DO_JUMP
- Survey（复杂任务）

---

## 相关源码位置速查

```
PX4-Autopilot-main/
  src/modules/mavlink/
    mavlink_mission.cpp         # Mission 协议实现
    mavlink_mission.h
  src/modules/navigator/
    navigator_main.cpp          # 导航主循环
    mission.cpp / mission.h     # Mission 执行
    rtl.cpp / rtl.h             # RTL 执行
    land.cpp / land.h           # Land 执行
    loiter.cpp / loiter.h       # Loiter 执行
    takeoff.cpp / takeoff.h     # Takeoff 执行
  src/modules/dataman/
    dataman.cpp                 # 持久化存储
  msg/versioned/
    MissionResult.msg           # Mission 结果
    VehicleMission.msg          # Mission 数据
    GeofenceResult.msg          # 围栏结果
```
