# MavDeck 项目总体概述

## 项目定位

MavDeck 是一个基于 Web 的 MAVLink 遥测可视化工具，由 Dan Wilson 开发并开源（MIT 协议）。

在线地址：https://mavdeck.netlify.app
GitHub：https://github.com/DanWilson00/MavDeck

## 核心特点

- **纯 Web 技术栈**：浏览器直接运行，无需安装桌面软件
- **PWA 离线可用**：可以像原生应用一样工作，支持 Service Worker 更新
- **动态协议解析**：通过加载 MAVLink XML 方言文件解析消息，不硬编码任何消息类型
- **高性能设计**：使用 Web Worker 处理数据解析，主线程只做渲染
- **Web Serial 连接**：支持原生 Web Serial API 和 Android WebUSB/FTDI

## 用户的目标（重构方向）

> 基于 MavDeck 做 Web 地面站升级，以尽量复现 QGroundControl 的核心内容为目标。

- 功能上按通用 UAV/GCS 路线推进，不专门针对无人船
- 适配目标上覆盖 PX4-Autopilot 和 ArduPilot
- 实施顺序上先从 PX4-Autopilot 开始
- 按阶段整理功能后交给 mentor 审核确认

## 技术栈

| 层面 | 技术 |
|------|------|
| 框架 | SolidJS 1.9.11 + TypeScript 5.9.3（严格模式）|
| 构建 | Vite 7.3.1 + vite-plugin-pwa |
| 样式 | Tailwind CSS v4.2.1 |
| 串口 | Web Serial API（浏览器原生）+ WebUSB/FTDI polyfill |
| 图表 | uPlot 1.6.32（Float64Array 原生）|
| 布局 | gridstack.js 12.4.2（12 列 Grafana 风格网格）|
| 地图 | Leaflet 1.9.4 + OpenStreetMap（CARTO Voyager / Esri）|
| 存储 | idb-keyval 6.2.2（IndexedDB 封装）+ OPFS（Origin Private File System）|
| 测试 | Vitest 4.0.18（happy-dom 环境）+ Playwright 1.58.2 |
| XML 解析 | DOMParser（浏览器原生）|
| 压缩 | xz-decompress 0.2.3 |

## 项目结构

```
/Users/zhengguo/Desktop/taiyi/重构/MavDeck/MavDeck-main/
├── src/
│   ├── mavlink/        # MAVLink 协议引擎（9 文件 + 5 测试）
│   ├── core/           # 共享工具（5 文件 + 4 测试）
│   ├── models/         # TypeScript 类型定义（3 文件）
│   ├── workers/        # Web Worker 基础设施（7 文件 + 6 测试）
│   ├── services/       # 数据管道服务（~45 文件 + 30+ 测试）
│   ├── components/     # SolidJS UI 组件（~24 文件 + 4 测试）
│   ├── hooks/          # SolidJS 钩子（10 文件 + 4 测试）
│   ├── store/          # 应用状态（3 文件 + 2 测试）
│   ├── test-helpers/   # 测试辅助（1 文件：load-dialect.ts）
│   ├── App.tsx         # 主应用组件
│   ├── index.tsx       # 应用入口
│   ├── global.css      # 全局样式
│   └── *.d.ts          # 类型声明文件
├── e2e/                # Playwright 端到端测试（5 文件）
├── public/
│   ├── dialects/       # MAVLink XML 方言文件（common.xml, standard.xml, minimal.xml）
│   ├── icon-*.png      # PWA 图标
│   ├── icon.svg        # SVG 图标
│   └── params.json     # 默认参数元数据
├── package.json
├── vite.config.ts
├── tsconfig.json
├── playwright.config.ts
├── netlify.toml
├── index.html
└── *.md                # 项目文档
```

## 关键文档

| 文件 | 作用 |
|------|------|
| `README.md` | 项目对外介绍，定位"轻量遥测工具" |
| `CLAUDE.md` | **开发规范圣经** — 架构决策、编码标准、性能要求、SolidJS 陷阱、测试策略 |
| `CONTRIBUTING.md` | 贡献指南，命名规范、PR 检查清单 |
| `CODE_OF_CONDUCT.md` | 标准 Contributor Covenant v2.1 |
| `讨论.md` | **用户写的规划文档** — 重构方向、mentor 对齐结论、六阶段实施路线 |

## 当前 MavDeck 能力 vs QGC 目标差距

| MavDeck 已有 | QGC 仍缺 |
|-------------|---------|
| Web 原生 + PWA | 完整的操作闭环（arm/disarm、模式切换）|
| MAVLink 解码/显示 | 任务规划（waypoint、mission 上传下载）|
| 地图、图表、遥测 | 参数流程化配置体验 |
| 参数基础能力 | Fly/Plan/Setup/Analyze 工作区组织 |
| 日志记录/回放 | 健康检查/告警/安全检查 |
| Web Worker 基础设施 | 多 autopilot 兼容适配层 |

## 代码统计

- 源码文件（ts/tsx）：约 170 个
- 测试文件：约 60 个
- 总模块：mavlink, core, workers, services, components, hooks, store, models
- 关键设计模式：WorkerController、EventEmitter、RingBuffer、Discriminated Union 协议
