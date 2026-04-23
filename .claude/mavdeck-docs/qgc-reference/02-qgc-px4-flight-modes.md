# QGC 中 PX4 飞行模式处理详解

## 核心文件

| 文件 | 作用 |
|------|------|
| `src/FirmwarePlugin/PX4/PX4FirmwarePlugin.cc` | 模式解码、编码、可用模式列表 |
| `src/FirmwarePlugin/PX4/PX4FirmwarePlugin.h` | 类定义、接口声明 |
| `src/FirmwarePlugin/PX4/px4_custom_mode.h` | PX4 custom_mode 枚举定义（QGC 自有副本） |
| `src/FirmwarePlugin/FirmwarePlugin.h` | 基类接口 |

---

## PX4 custom_mode 编码规则

PX4 使用 `HEARTBEAT.custom_mode` (uint32_t) 编码飞行模式：

```cpp
union px4_custom_mode {
    struct {
        uint16_t reserved;   // bits 16-31
        uint8_t  main_mode;  // bits 8-15
        uint8_t  sub_mode;   // bits 0-7
    };
    uint32_t data;
};
```

**QGC 的编码方式**（见 `px4_custom_mode.h` 中的 `PX4CustomMode::Mode`）：

```cpp
// 纯主模式（无子模式）：main_mode 左移 16 位
MANUAL    = PX4_CUSTOM_MAIN_MODE_MANUAL    << 16  // 0x00010000
STABILIZED= PX4_CUSTOM_MAIN_MODE_STABILIZED<< 16  // 0x00070000
ACRO      = PX4_CUSTOM_MAIN_MODE_ACRO      << 16  // 0x00050000
RATTITUDE = PX4_CUSTOM_MAIN_MODE_RATTITUDE << 16  // 0x00080000
ALTCTL    = PX4_CUSTOM_MAIN_MODE_ALTCTL    << 16  // 0x00020000
OFFBOARD  = PX4_CUSTOM_MAIN_MODE_OFFBOARD  << 16  // 0x00060000
SIMPLE    = PX4_CUSTOM_MAIN_MODE_SIMPLE    << 16  // 0x00090000

// 含子模式：main_mode 左移 16 位 | sub_mode 左移 24 位
// 注意：QGC 的编码与 PX4 源码略有不同！
POSCTL_POSCTL = PX4_CUSTOM_MAIN_MODE_POSCTL << 16 | (PX4_CUSTOM_SUB_MODE_POSCTL_POSCTL << 24)  // 0x03000000
POSCTL_ORBIT  = PX4_CUSTOM_MAIN_MODE_POSCTL << 16 | (PX4_CUSTOM_SUB_MODE_POSCTL_ORBIT  << 24)  // 0x03010000
AUTO_LOITER   = PX4_CUSTOM_MAIN_MODE_AUTO   << 16 | (PX4_CUSTOM_SUB_MODE_AUTO_LOITER   << 24)  // 0x04030000
AUTO_MISSION  = PX4_CUSTOM_MAIN_MODE_AUTO   << 16 | (PX4_CUSTOM_SUB_MODE_AUTO_MISSION  << 24)  // 0x04040000
AUTO_RTL      = PX4_CUSTOM_MAIN_MODE_AUTO   << 16 | (PX4_CUSTOM_SUB_MODE_AUTO_RTL      << 24)  // 0x04050000
AUTO_LAND     = PX4_CUSTOM_MAIN_MODE_AUTO   << 16 | (PX4_CUSTOM_SUB_MODE_AUTO_LAND     << 24)  // 0x04060000
AUTO_PRECLAND = PX4_CUSTOM_MAIN_MODE_AUTO   << 16 | (PX4_CUSTOM_SUB_MODE_AUTO_PRECLAND << 24)  // 0x04080000
AUTO_READY    = PX4_CUSTOM_MAIN_MODE_AUTO   << 16 | (PX4_CUSTOM_SUB_MODE_AUTO_READY    << 24)  // 0x04010000
AUTO_RTGS     = PX4_CUSTOM_MAIN_MODE_AUTO   << 16 | (PX4_CUSTOM_SUB_MODE_AUTO_RTGS     << 24)  // 0x04070000
AUTO_TAKEOFF  = PX4_CUSTOM_MAIN_MODE_AUTO   << 16 | (PX4_CUSTOM_SUB_MODE_AUTO_TAKEOFF  << 24)  // 0x04020000
AUTO_FOLLOW_TARGET = ... // 0x04080000
```

**重要差异**: QGC 的 `PX4CustomMode::Mode` 枚举将子模式放在 bits 24-31，而 PX4 源码的 `px4_custom_mode` union 将 `sub_mode` 放在 bits 0-7。实际上 QGC 在编码时直接使用这些组合好的 uint32_t 值作为 lookup key，不需要再拆分为 main/sub。

---

## 模式名称映射表

`PX4FirmwarePlugin` 构造函数中初始化的完整映射（`_modeEnumToString`）：

| uint32_t 值 | 模式名称（英文） | 中文 | 可否手动设置 |
|-------------|----------------|------|------------|
| `0x00010000` | Manual | 手动 | ✅ |
| `0x00070000` | Stabilized | 自稳 | ✅ |
| `0x00050000` | Acro | 特技 | ✅ |
| `0x00080000` | Rattitude | 半特技 | ✅ |
| `0x00020000` | Altitude | 定高 | ✅ |
| `0x00060000` | Offboard | 外部控制 | ✅ |
| `0x00090000` | Simple | 简单 | ❌ |
| `0x00030000` | Position | 定点 | ✅ |
| `0x01030000` | Orbit | 环绕 | ❌ |
| `0x03040000` | Hold | 悬停/保持 | ✅ |
| `0x04040000` | Mission | 任务 | ✅ |
| `0x05040000` | Return | 返航 | ✅ |
| `0x06040000` | Land | 降落 | ❌ |
| `0x09040000` | Precision Land | 精准降落 | ✅ |
| `0x01040000` | Ready | 准备 | ❌ |
| `0x07040000` | Return to Groundstation | 返地面站 | ❌ |
| `0x02040000` | Takeoff | 起飞 | ❌ |
| `0x08040000` | Follow Me | 跟随我 | ❌ |

---

## 模式解码流程

```cpp
QString PX4FirmwarePlugin::flightMode(uint8_t base_mode, uint32_t custom_mode) const
{
    QString flightMode = "Unknown";
    if (base_mode & MAV_MODE_FLAG_CUSTOM_MODE_ENABLED) {
        return _modeEnumToString.value(custom_mode, 
            tr("Unknown %1:%2").arg(base_mode).arg(custom_mode));
    }
    return flightMode;
}
```

**逻辑**：
1. 检查 `base_mode & MAV_MODE_FLAG_CUSTOM_MODE_ENABLED` (0x80)
2. 若启用，直接用 `custom_mode` 查 `_modeEnumToString` map
3. 找不到则返回 `"Unknown base:custom"`

---

## 模式编码流程（设置模式）

```cpp
bool PX4FirmwarePlugin::setFlightMode(const QString& flightMode, 
                                       uint8_t* base_mode, 
                                       uint32_t* custom_mode) const
{
    *base_mode = 0;
    *custom_mode = 0;
    bool found = false;

    for (auto &mode: _flightModeList) {
        if (flightMode.compare(mode.mode_name, Qt::CaseInsensitive) == 0) {
            *base_mode = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED;
            *custom_mode = mode.custom_mode;
            found = true;
            break;
        }
    }
    return found;
}
```

**设置模式时发送的命令**：
- `MAV_CMD_DO_SET_MODE` (176)
  - param1: `MAV_MODE_FLAG_CUSTOM_MODE_ENABLED` (0x80) — 有时也加上 `MAV_MODE_FLAG_SAFETY_ARMED` (0x80 | 0x40 = 0xC0)
  - param2: `custom_mode` (uint32_t)

---

## 可用模式列表（按机型过滤）

```cpp
QStringList PX4FirmwarePlugin::flightModes(Vehicle* vehicle) const
{
    QStringList flightModesList;
    for (auto &mode : _flightModeList) {
        if (mode.canBeSet) {
            bool fw = (vehicle->fixedWing() && mode.fixedWing);
            bool mc = (vehicle->multiRotor() && mode.multiRotor);
            bool other = !vehicle->fixedWing() && !vehicle->multiRotor();
            if (fw || mc || other) {
                flightModesList += mode.mode_name;
            }
        }
    }
    return flightModesList;
}
```

**机型过滤规则**（`updateAvailableFlightModes`）：

| 模式 | 多旋翼 | 固定翼 |
|------|--------|--------|
| Manual | ✅ | ✅ |
| Stabilized | ✅ | ✅ |
| Acro | ✅ | ✅ |
| Rattitude | ✅ | ✅ |
| Altitude | ✅ | ✅ |
| Offboard | ✅ | ❌ |
| Simple | ✅ | ❌ |
| Position | ✅ | ✅ |
| Orbit | ❌ | ❌ |
| Hold | ✅ | ✅ |
| Mission | ✅ | ✅ |
| Return | ✅ | ✅ |
| Land | ✅ | ✅ |
| Precision Land | ✅ | ❌ |
| Ready | ✅ | ✅ |
| Return to GS | ❌ | ❌ |
| Takeoff | ✅ | ✅ |
| Follow Me | ✅ | ❌ |

**注意**: 对于通用机型、VTOL、无人车/船，`other = true`，所以会显示所有 `canBeSet=true` 的模式。

---

## 引导模式（Guided Mode）快捷方法

PX4 使用特定的模式名称作为引导动作的目标：

| 方法 | 返回模式 | 实际 custom_mode 值 |
|------|---------|-------------------|
| `pauseFlightMode()` | Hold | `AUTO_LOITER` (0x03040000) |
| `missionFlightMode()` | Mission | `AUTO_MISSION` (0x04040000) |
| `rtlFlightMode()` | Return | `AUTO_RTL` (0x05040000) |
| `landFlightMode()` | Land | `AUTO_LAND` (0x06040000) |
| `takeControlFlightMode()` | Manual | `MANUAL` (0x00010000) |
| `gotoFlightMode()` | Hold | `AUTO_LOITER` (0x04030000) |
| `followFlightMode()` | Follow Me | `AUTO_FOLLOW_TARGET` |
| `takeOffFlightMode()` | Takeoff | `AUTO_TAKEOFF` (0x02040000) |
| `stabilizedFlightMode()` | Stabilized | `STABILIZED` (0x00070000) |

---

## MavDeck 实现参考

MavDeck 需要创建 `src/mavlink/px4-mode-decoder.ts`，核心函数：

```typescript
// 参考 QGC 的 _modeEnumToString 映射
type Px4ModeMap = Record<number, string>;

const PX4_MODE_MAP: Px4ModeMap = {
  0x00010000: 'Manual',
  0x00070000: 'Stabilized',
  0x00050000: 'Acro',
  0x00080000: 'Rattitude',
  0x00020000: 'Altitude',
  0x00060000: 'Offboard',
  0x00090000: 'Simple',
  0x00030000: 'Position',
  0x01030000: 'Orbit',
  0x03040000: 'Hold',
  0x04040000: 'Mission',
  0x05040000: 'Return',
  0x06040000: 'Land',
  0x09040000: 'Precision Land',
  0x01040000: 'Ready',
  0x07040000: 'Return to Groundstation',
  0x02040000: 'Takeoff',
  0x08040000: 'Follow Me',
};

export function decodePx4FlightMode(baseMode: number, customMode: number): string {
  if ((baseMode & 0x80) === 0) {
    return 'Unknown';
  }
  return PX4_MODE_MAP[customMode] ?? `Unknown ${baseMode}:${customMode}`;
}
```

---

## 相关源码位置速查

```
qgroundcontrol-master/
  src/FirmwarePlugin/
    PX4/
      PX4FirmwarePlugin.cc    # 模式映射核心（第25-88行构造函数，第119-151行编解码）
      PX4FirmwarePlugin.h     # 类接口声明
      px4_custom_mode.h       # 枚举定义（第48-69行 PX4CustomMode）
    FirmwarePlugin.h          # 基类（flightMode / setFlightMode 虚函数）
    FirmwarePlugin.cc         # 基类默认实现
  src/Vehicle/
    Vehicle.cc                # sendMavCommand, setFlightMode, armed 状态
    Vehicle.h                 # Vehicle 类定义
```
