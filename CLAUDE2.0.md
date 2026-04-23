# CLAUDE 2.0 — 项目目标与阶段修正版

> 本文件用于确保 Claude 在每次会话开始时回顾项目真实状态，避免重复造轮子或偏离目标。

---

## 一句话目标

基于 **MavDeck** 做 Web 地面站升级，以尽量复现 **QGroundControl** 的核心控制与规划能力为目标；功能上按通用成熟 GCS 路线推进，不专门针对无人船改功能体系；适配目标上覆盖 **PX4-Autopilot** 和 **ArduPilot**，但实施顺序上先从 **PX4** 开始，并按阶段整理功能后交给 mentor 审核确认。

---

## MavDeck 已有什么（底座极强大，不要重复造轮子）

MavDeck 不是空壳，它是一个**已经能独立运行的高级 MAVLink 遥测看板 + 参数调参工具**：

- **连接层**：Web Serial / WebUSB / 自动连接 / 自动波特率探测 / Tlog 录制与回放
- **遥测显示**：uPlot 时间序列图表、Leaflet 地图（实时轨迹 / 回放 / 图层切换）、MessageMonitor（消息级字段监控）、StatusTextLog
- **参数系统**：参数读取 / 写入 / 搜索 / 分组 / 标量 + 数组编辑 / 元数据驱动 UI
- **数据管道**：Web Worker 解析、零拷贝环形缓冲区、消息频率统计、感兴趣字段优化
- **PWA**：离线能力、安装提示、更新检测、主题 / 单位 / 设置持久化
- **测试体系**：490 个测试通过

**关键提醒**：当我想做"显示电池电压"、"显示 GPS 卫星数"、"显示传感器健康"时，先停一下——这些数据在 **MessageMonitor** 里已经能看了。Phase 1 的 FlightStatusPanel 只做了模式 + 武装状态，没有也不需要做电池/GPS/健康组件。

---

## MavDeck 真正缺什么（核心差距）

这些才是从"遥测看板"升级为"地面站"必须补齐的：

1. **控制闭环** — 只能看，不能发指令（Arm/Disarm、模式切换、Takeoff、Land、RTL、Goto）
2. **任务规划（Plan View）** — 没有航点编辑、任务上传 / 下载
3. **Setup 向导** — 参数列表有，但没有传感器校准、遥控器配置等向导式流程
4. **预飞检查** — 没有安全检查清单
5. **多 Autopilot 兼容** — 目前只有 PX4 模式映射，没有 ArduPilot 适配层

---

## 修正后的 Phase 定义

### Phase 1：PX4 模式解码 + FlightStatusPanel ✅ 已完成
- `px4-mode-decoder.ts` + 测试
- `FlightStatusPanel.tsx` + 测试
- Worker heartbeat 事件、Store 状态字段、disconnect 重置
- **注意**：没有做电池/GPS/健康子组件，因为 MessageMonitor 已覆盖

### Phase 2：控制闭环（Arm/Disarm + 模式切换 + Guided Actions）🔥 当前重点
- Arm/Disarm 按钮 + 安全确认
- 飞行模式下拉 / 按钮组
- Takeoff / Land / RTL / Goto 快捷操作
- Command sender 服务（ACK 跟踪、超时、重试）
- Worker 协议扩展：`sendCommand` / `commandAck`
- **意义**：这是从" viewer "变" controller "的分水岭

### Phase 3：任务规划（Plan View）
- 新增 Plan Tab
- 地图点击添加航点、拖拽调整、删除
- Mission 上传 / 下载（MAVLink mission protocol v2）
- 当前任务进度显示

### Phase 4：Setup / 配置向导
- 传感器校准向导（罗盘 / 加速度计 / 陀螺仪）
- 遥控器配置
- 飞行模式开关映射
- 电源 / 安全设置
- **关键**：复用现有参数系统，只是套一个向导式 UI

### Phase 5：ArduPilot 双栈适配
- `autopilot-adapter.ts` 接口
- `px4-adapter.ts` / `ardupilot-adapter.ts`
- HEARTBEAT.autopilot 检测，动态切换适配器

---

## 最重要的工作原则

1. **不要重复造轮子**：MavDeck 的 MAVLink 引擎、Worker 管道、参数系统、地图、图表都已非常成熟。新增功能应该是**在底座上加控制能力和工作流**，不是重新做底座。
2. **先控制后规划**：Phase 2 控制闭环的优先级高于 Phase 3 任务规划。没有控制能力的地面站只是高级看板。
3. **PX4 先行**：不要一开始就想兼容 ArduPilot，先把 PX4 的控制闭环跑通。
4. **测试先行**：每个新功能必须带测试，已有 490 个测试不能破。
5. **最小改动**：touch only what's needed。不要为了一点 UI 美观去重构整个组件树。
