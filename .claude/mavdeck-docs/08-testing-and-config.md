# 测试策略与配置文件

## 三层测试架构

### Tier 1 — Vitest 单元测试（快速，始终运行）

**环境**：`happy-dom`（由 `vite.config.ts` 配置）

**目标**：< 5 秒总运行时间

**测试内容**：
| 模块 | 测试文件 | 覆盖内容 |
|------|---------|---------|
| mavlink | `crc.test.ts` | 黄金值 CRC 计算 |
| mavlink | `frame-parser.test.ts` | 帧构建→解析 端到端 |
| mavlink | `decoder.test.ts` | Payload 解码 |
| mavlink | `registry.test.ts` | 方言加载和查找 |
| mavlink | `xml-parser.test.ts` | XML→JSON 解析 |
| core | `ring-buffer.test.ts` | 环绕、容量、uPlot 兼容 |
| core | `event-emitter.test.ts` | 订阅/取消订阅 |
| core | `crc32.test.ts` | 标准 CRC32 向量 |
| core | `plot-interactions.test.ts` | 缩放同步 |
| services | `mavlink-service.test.ts` | 流水线数据流 |
| services | `message-tracker.test.ts` | 频率计算 |
| services | `timeseries-manager.test.ts` | 环形缓冲区填充 |
| services | `parameter-manager.test.ts` | 参数协议 |
| services | `ftp-client.test.ts` | 文件下载状态机 |
| services | `tlog-codec.test.ts` | 编码/解码 |
| services | `tlog-service.test.ts` | 暂存/恢复 |
| workers | `worker-controller.test.ts` | 命令处理 |
| workers | `throughput-monitor.test.ts` | 吞吐量 |
| workers | `data-activity-monitor.test.ts` | 空闲检测 |
| ... | 更多 | 见各模块文档 |

**黄金值测试**是最高价值的测试 — 已知输入→已知输出，零歧义。

### Tier 2 — Vitest 集成测试（中等，始终运行）

**测试内容**：
| 测试 | 方法 |
|------|------|
| Spoof → Parser → Decoder | `SpoofByteSource` + `FrameParser` + `Decoder` |
| TimeSeriesManager | 喂入解码消息，验证环形缓冲区键 |
| WorkerController | mock `postEvent`，验证状态转换 |
| Serial handlers | mock `WorkerSerialByteSource` 和 `SerialProbeService` |

### Tier 3 — Playwright E2E（慢速，合并前运行）

**配置**：`playwright.config.ts`
- 测试目录：`./e2e`
- 超时：30s，expect 超时：10s
- 工作者：1（非并行）
- 重试：CI 中 2 次
- 报告器：CI 中 HTML + GitHub，本地仅失败时 HTML
- Base URL：`http://localhost:5173`
- 失败时捕获：trace、screenshot、video
- 目标：仅 Chromium 桌面
- 自动启动 dev server：`npm run dev`

**测试文件**：
| 文件 | 覆盖 |
|------|------|
| `connection.spec.ts` | 连接生命周期、暂停/恢复 |
| `telemetry.spec.ts` | 消息监控、字段展开、频率徽章 |
| `plots.spec.ts` | 添加绘图、信号选择、canvas 渲染、清除/删除 |
| `parameters.spec.ts` | 读取参数、搜索过滤、修改保存 |

**页面对象**：`helpers.ts` — `MavDeckPage` 类封装常见交互

---

## 配置文件详解

### vite.config.ts

```typescript
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/MavDeck/' : '/',
  plugins: [
    solidPlugin(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,svg,png}']
      },
      manifest: {
        name: 'MavDeck',
        theme_color: '#111217',
        icons: [...]
      }
    })
  ],
  test: {
    environment: 'happy-dom',
    exclude: ['e2e/**']
  }
})
```

**要点**：
- `happy-dom` 环境提供 `DOMParser`（XML 解析测试必需）
- PWA 缓存 JS/CSS/HTML/JSON/SVG/PNG
- GitHub Actions 时 base 路径为 `/MavDeck/`

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

**要点**：
- `strict: true` — TypeScript 严格模式
- `jsxImportSource: "solid-js"` — SolidJS JSX 转换
- `noEmit: true` — Vite 处理编译，tsc 仅类型检查

### playwright.config.ts

详见 Tier 3 部分。

### netlify.toml

```toml
[build]
  command = "npm run build"
  publish = "dist"
  environment = { NODE_VERSION = "20" }

[[headers]]
  for = "/*"
  [headers.values]
    Permissions-Policy = "usb=(self)"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

**要点**：
- `Permissions-Policy: usb=(self)` — 允许 WebUSB
- SPA fallback — 所有路径返回 `index.html`

### index.html

```html
<html lang="en" class="dark">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MavDeck</title>
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <div id="root"></div>
  <script type="module" src="/src/index.tsx"></script>
</html>
```

---

## 测试运行命令

```bash
# 所有单元/集成测试
npx vitest run

# 仅 MAVLink 引擎测试
npx vitest run src/mavlink/

# 仅核心工具测试
npx vitest run src/core/

# 仅服务层测试
npx vitest run src/services/

# 仅 Worker 测试
npx vitest run src/workers/

# 仅组件测试
npx vitest run src/components/

# 仅 hooks 测试
npx vitest run src/hooks/

# 仅 store 测试
npx vitest run src/store/

# E2E 测试（需要 npx playwright install chromium）
npm run e2e

# 有界面的 E2E
npm run e2e:headed

# 完整验证（类型检查 + 构建 + 测试）
npm run verify
# 等价于：npm run typecheck && npm run build && npm run test

# 生产构建
npm run build

# 开发服务器
npm run dev
```

---

## 测试文件命名规范

| 类型 | 路径模式 | 示例 |
|------|---------|------|
| 单元测试 | `src/**/__tests__/<name>.test.ts` | `src/mavlink/__tests__/crc.test.ts` |
| 组件测试 | `src/components/__tests__/<name>.test.tsx` | `src/components/__tests__/Toolbar.test.tsx` |
| E2E 测试 | `e2e/<name>.spec.ts` | `e2e/connection.spec.ts` |

**要求**：
- 使用 `describe`/`it` 块
- 优先 `expect` 断言
- `beforeEach` 做设置，不用共享可变状态

---

## Playwright MCP 视觉验证

**用途**（非测试套件，是验证工具）：
1. 后台启动 dev server：`npm run dev`
2. `browser_navigate` → `browser_snapshot` → 验证元素存在
3. 错误时：编辑代码 → Vite HMR 重载 → `browser_snapshot` 再次验证
4. `browser_click` / `browser_type` → 测试交互
5. `browser_console_messages(level="error")` → 捕获 JS 错误
6. `browser_take_screenshot` → 验证视觉外观

**适用场景**：UI 渲染、数据流到 UI、样式、实时更新、"看起来不对"调试

**不适用场景**：纯逻辑（用 Vitest）、类型检查（用 `npm run build`）、性能分析
