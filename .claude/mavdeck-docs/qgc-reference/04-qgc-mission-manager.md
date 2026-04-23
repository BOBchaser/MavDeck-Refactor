# QGC Mission 协议与任务规划详解

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/MissionManager/PlanManager.cc` | Mission 协议状态机（上传/下载/清除） |
| `src/MissionManager/MissionController.cc` | Mission UI 控制器（地图交互、列表管理） |
| `src/MissionManager/MissionManager.cc` | Mission 数据模型 |
| `src/MissionManager/SimpleMissionItem.cc` | 简单航点项（Waypoint/Takeoff/RTL/Land） |
| `src/MissionManager/ComplexMissionItem.cc` | 复杂任务项（Survey、Corridor Scan） |
| `src/PlanView/PlanView.qml` | Plan 视图主 QML |
| `src/PlanView/MissionItemEditor.qml` | 航点编辑器 UI |

---

## MAVLink Mission 协议 v2

QGC 使用 MAVLink Mission 协议 v2 与飞控交换任务数据：

### 消息类型

| 消息 | 方向 | 用途 |
|------|------|------|
| `MISSION_COUNT` | GCS → 飞控 | 通知即将上传的 mission 项数量 |
| `MISSION_REQUEST_INT` | GCS → 飞控 | 请求指定序号的 mission 项（推荐） |
| `MISSION_ITEM_INT` | 双向 | 单个 mission 项数据（高精度坐标） |
| `MISSION_ACK` | 双向 | 确认或拒绝 mission 操作 |
| `MISSION_CURRENT` | 飞控 → GCS | 当前执行的 mission 序号 |
| `MISSION_ITEM_REACHED` | 飞控 → GCS | 到达某个 mission 项 |
| `MISSION_REQUEST_LIST` | GCS → 飞控 | 请求下载 mission 列表 |

### 上传流程（GCS → 飞控）

```
GCS                                    飞控
 |                                      |
 |--- MISSION_COUNT (n) -------------->|
 |<-- MISSION_REQUEST_INT (seq=0) -----|
 |--- MISSION_ITEM_INT (seq=0) ------->|
 |<-- MISSION_REQUEST_INT (seq=1) -----|
 |--- MISSION_ITEM_INT (seq=1) ------->|
 |              ...                     |
 |<-- MISSION_REQUEST_INT (seq=n-1) ---|
 |--- MISSION_ITEM_INT (seq=n-1) ----->|
 |<-- MISSION_ACK (ACCEPTED) ----------|
```

### 下载流程（飞控 → GCS）

```
GCS                                    飞控
 |                                      |
 |--- MISSION_REQUEST_LIST ----------->|
 |<-- MISSION_COUNT (n) ---------------|
 |--- MISSION_REQUEST_INT (seq=0) ---->|
 |<-- MISSION_ITEM_INT (seq=0) --------|
 |              ...                     |
 |--- MISSION_ACK (ACCEPTED) --------->|
```

---

## PlanManager 状态机

`PlanManager.cc` 使用状态机管理 mission 传输：

### 状态枚举

```cpp
enum class PlanState {
    Idle,           // 空闲
    Downloading,    // 正在下载
    Uploading,      // 正在上传
    Removing,       // 正在清除
};
```

### 关键方法

```cpp
// 开始下载 mission
void PlanManager::downloadFromVehicle();

// 开始上传 mission
void PlanManager::uploadToVehicle(const QList<MissionItem*>& missionItems);

// 清除 mission
void PlanManager::removeAll();

// 处理 MAVLink 消息
void PlanManager::_handleMissionCount(const mavlink_message_t& message);
void PlanManager::_handleMissionItemInt(const mavlink_message_t& message);
void PlanManager::_handleMissionRequestInt(const mavlink_message_t& message);
void PlanManager::_handleMissionAck(const mavlink_message_t& message);
```

### 重试与超时

- 每个 `MISSION_REQUEST_INT` / `MISSION_ITEM_INT` 有独立的超时定时器
- 超时后重发请求（默认重试 5 次）
- 整个传输有总超时保护

---

## Mission 项类型

### SimpleMissionItem（简单航点）

`SimpleMissionItem` 封装单个 `MAV_CMD`：

| MAV_CMD | 名称 | 参数 |
|---------|------|------|
| `MAV_CMD_NAV_WAYPOINT` | 航点 | param1: hold time, param5/6/7: lat/lon/alt |
| `MAV_CMD_NAV_TAKEOFF` | 起飞 | param1: pitch, param7: alt |
| `MAV_CMD_NAV_LAND` | 降落 | param4: yaw, param5/6: lat/lon |
| `MAV_CMD_NAV_RETURN_TO_LAUNCH` | 返航 | 无参数 |
| `MAV_CMD_NAV_LOITER_UNLIM` | 无限悬停 | param5/6/7: lat/lon/alt |
| `MAV_CMD_NAV_LOITER_TIME` | 定时悬停 | param1: time |
| `MAV_CMD_DO_JUMP` | 跳转 | param1: seq, param2: repeat |
| `MAV_CMD_DO_CHANGE_SPEED` | 改速度 | param1: type, param2: speed |
| `MAV_CMD_DO_SET_SERVO` | 设置舵机 | param1: servo, param2: pwm |

### ComplexMissionItem（复杂任务）

- `SurveyComplexItem` — 区域扫描
- `CorridorScanComplexItem` — 走廊扫描
- `StructureScanComplexItem` — 结构扫描

---

## Geofence 与 Rally Point

### Geofence（地理围栏）

| 文件 | 作用 |
|------|------|
| `src/MissionManager/GeoFenceController.cc` | 围栏控制器 |
| `src/MissionManager/GeoFenceManager.cc` | 围栏数据模型 |

MAVLink 消息：
- `FENCE_POINT` (v1) / `FENCE_BREACH` / `FENCE_STATUS`
- PX4 使用 `NAV_FENCE` 参数和 `FENCE_*` MAVLink 消息

### Rally Point（集结点）

| 文件 | 作用 |
|------|------|
| `src/MissionManager/RallyPointController.cc` | 集结点控制器 |
| `src/MissionManager/RallyPointManager.cc` | 集结点数据模型 |

MAVLink 消息：
- `RALLY_POINT` / `RALLY_FETCH_POINT`

---

## MavDeck 实现要点

MavDeck 目前**不支持** Mission 协议。Phase 4 需要实现：

1. **Mission 协议状态机**（参考 `PlanManager.cc`）
2. **Mission 数据模型**（航点列表、当前序号、已到达序号）
3. **地图交互**（点击添加航点、拖拽调整位置）
4. **Mission 编辑器 UI**（列表 + 参数编辑）
5. **上传/下载按钮**

**可先支持的 mission 项类型**：
- Takeoff
- Waypoint
- RTL
- Land

**后续扩展**：
- Loiter
- Survey
- Geofence
- Rally Point

---

## 相关源码位置速查

```
qgroundcontrol-master/
  src/MissionManager/
    PlanManager.cc              # Mission 协议状态机
    PlanManager.h
    MissionController.cc        # UI 控制器
    MissionController.h
    MissionManager.cc           # 数据模型
    MissionManager.h
    SimpleMissionItem.cc        # 简单航点
    SimpleMissionItem.h
    ComplexMissionItem.cc       # 复杂任务
    ComplexMissionItem.h
    GeoFenceController.cc       # 地理围栏
    RallyPointController.cc     # 集结点
  src/PlanView/
    PlanView.qml                # Plan 视图主界面
    MissionItemEditor.qml       # 航点编辑器
    MissionItemStatus.qml       # 状态显示
```
