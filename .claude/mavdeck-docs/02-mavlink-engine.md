# MAVLink 协议引擎（mavlink/ 模块）

## 文件列表

| 文件 | 职责 |
|------|------|
| `src/mavlink/crc.ts` | X.25 CRC-16 (CRC-16-MCRF4XX) 实现 |
| `src/mavlink/metadata.ts` | 消息/字段/枚举元数据类型定义和工厂函数 |
| `src/mavlink/registry.ts` | 内存中元数据注册表，O(1) 查找 |
| `src/mavlink/frame.ts` | 协议常量和 `MavlinkFrame` 接口 |
| `src/mavlink/frame-parser.ts` | 字节级状态机，解析 MAVLink v1/v2 帧 |
| `src/mavlink/decoder.ts` | 将 payload 解码为结构化 `MavlinkMessage` |
| `src/mavlink/frame-builder.ts` | 从消息名 + 字段值构建有效 MAVLink v2 帧 |
| `src/mavlink/xml-parser.ts` | 运行时解析 MAVLink XML 方言，生成 JSON 元数据 |
| `src/mavlink/index.ts` | Barrel 导出 |

---

## crc.ts — CRC 计算

**算法**：MAVLink X.25 CRC-16 (CRC-16-MCRF4XX)，种子 `0xFFFF`

**导出**：
```typescript
class MavlinkCrc {
  accumulate(byte: number): void
  accumulateBytes(data: Uint8Array): void
  accumulateString(str: string): void
  reset(): void
  get lowByte(): number
  get highByte(): number
}

function calculateFrameCrc(
  frame: MavlinkFrame,
  crcExtra: number,
  registry: MavlinkMetadataRegistry
): number
```

**使用方**：
- `frame-parser.ts` — 验证入站帧 CRC
- `frame-builder.ts` — 计算出站帧 CRC
- `xml-parser.ts` — 生成 `crc_extra`

---

## metadata.ts — 元数据类型

**核心类型**：
```typescript
interface MavlinkFieldMetadata {
  name: string
  type: string
  baseType: string
  arrayLength: number      // 默认 1
  isExtension: boolean     // 默认 false
  enum?: string
  units?: string
  printFormat?: string
  description?: string
  wireOffset: number       // 编码偏移
  encodedLength: number    // 该字段在 payload 中的字节数
}

interface MavlinkMessageMetadata {
  name: string
  id: number
  description?: string
  fields: MavlinkFieldMetadata[]
  extensionFields: MavlinkFieldMetadata[]
  crcExtra: number
  encodedLength: number    // 非扩展字段总长度
}

interface MavlinkEnumEntry {
  value: number
  name: string
  description?: string
}

interface MavlinkEnumMetadata {
  name: string
  entries: Map<number, MavlinkEnumEntry>  // O(1) 查找
}
```

**工厂函数**：`createFieldMetadata`, `createMessageMetadata`, `createEnumMetadata`
- 将可选字段强制转换为默认值

---

## registry.ts — 元数据注册表

**类**：`MavlinkMetadataRegistry`

**内部存储**：
```typescript
messagesById: Map<number, MavlinkMessageMetadata>
messagesByName: Map<string, MavlinkMessageMetadata>
enums: Map<string, MavlinkEnumMetadata>
```

**方法**：
- `loadFromJsonString(json: string)` — 加载方言 JSON
- `getMessageById(id: number)` / `getMessageByName(name: string)`
- `getEnum(name: string)`
- `resolveEnumValue(enumName: string, value: number): string | undefined`

**加载流程**：
1. `dialect-loader.ts` 读取 XML 文件内容
2. `xml-parser.ts` 解析为 JSON 字符串
3. `registry.loadFromJsonString()` 加载到内存 Map

---

## frame.ts — 协议常量

```typescript
enum MavlinkVersion { V1, V2 }

const MAVLINK_V1_STX = 0xFE
const MAVLINK_V2_STX = 0xFD
const MAVLINK_V1_HEADER_LEN = 6
const MAVLINK_V2_HEADER_LEN = 10
const MAVLINK_MAX_PAYLOAD_LEN = 255
const MAVLINK_CRC_LEN = 2

interface MavlinkFrame {
  version: MavlinkVersion
  length: number
  sequence: number
  systemId: number
  componentId: number
  messageId: number
  payload: Uint8Array
  checksum: number
}
```

**帧格式 v2**：
```
STX(0xFD) | len | incompat | compat | seq | sysid | compid | msgid_lo | msgid_mid | msgid_hi | payload | crc_lo | crc_hi
```

**帧格式 v1**：
```
STX(0xFE) | len | seq | sysid | compid | msgid | payload | crc_lo | crc_hi
```

---

## frame-parser.ts — 帧解析状态机

**类**：`MavlinkFrameParser`

**状态**：`ParserState` enum
```
WaitingForStx → ReadingLength → ReadingIncompatFlags → ReadingCompatFlags
→ ReadingSequence → ReadingSystemId → ReadingComponentId
→ ReadingMessageId → ReadingPayload → ReadingCrcLow → ReadingCrcHigh
→ FrameComplete → (循环回 WaitingForStx)
```

**零分配热路径优化**：
- 预分配 `headerBuffer`（9 字节）
- 预分配 `payloadBuffer`（255 字节）
- 复用单个 `MavlinkCrc` 实例

**统计**：
- `framesReceived` — 成功帧数
- `crcErrors` — CRC 错误数
- `unknownMessages` — 未知消息 ID 数

**行为**：
- CRC 验证失败则丢弃帧，自动在下一个有效 STX 重新同步
- 未知消息 ID（注册表无 crcExtra）则丢弃并计数

**API**：
```typescript
onFrame(callback: (frame: MavlinkFrame) => void): () => void  // 返回取消订阅
feedBytes(data: Uint8Array): void
```

---

## decoder.ts — Payload 解码器

**类**：`MavlinkMessageDecoder`

**导出**：
```typescript
interface MavlinkMessage {
  name: string
  fields: Record<string, unknown>
  timestamp: number  // ms
}
```

**解码过程**：
1. 通过 `registry.getMessageById(frame.messageId)` 获取元数据
2. 处理 MAVLink v2 zero-trimming：
   - 短 payload 用预分配 `paddingBuffer` 填充到 `metadata.encodedLength`
   - 避免每条消息都分配新 buffer
3. 用 `DataView` 小端序读取所有 MAVLink 类型：
   - `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`, `float`, `double`
   - `int64`/`uint64`：拆分为 hi/lo 32 位字
4. `char[]` 数组转为以 null 结尾的字符串
5. 数值数组返回 `number[]`，截断的元素用 0 填充

**特殊处理**：
- 未知消息 ID 返回 `null`
- 数组字段的索引表示：`fieldName[0]`, `fieldName[1]`...

---

## frame-builder.ts — 帧构建器

**类**：`MavlinkFrameBuilder`

**用途**：主要用于测试和模拟器（`SpoofByteSource`）生成 MAVLink 帧

**构建流程**：
1. 通过 `registry.getMessageByName(name)` 查找元数据
2. 按字段顺序用 `DataView` 小端序编码 payload
3. 组装 v2 头部：len, incompat, compat, seq, sysid, compid, 3-byte msgid
4. 计算 CRC（header 字节（不含 STX）+ payload + crcExtra）
5. 返回完整 `Uint8Array`：`STX + header + payload + CRC`

**支持类型**：
- 标量和数组编码
- `int64`/`uint64` 拆分为 lo/hi 32 位字
- 跳过扩展字段（构建时）

---

## xml-parser.ts — XML 方言解析

**导出**：
```typescript
function parseFromFileMap(
  files: Map<string, string>,
  mainFile: string
): string  // 返回 JSON 字符串

function normalizeDialectFilename(filename: string): string
```

**解析流程**：
1. 递归解析 `<include>` 标签（归一化为纯文件名）
2. 解析 `<enum>` 和 `<message>` 元素
3. **字段排序**：非扩展字段按类型大小降序排列（最大在前），扩展字段保持原始顺序并放在最后
4. **偏移计算**：排序后顺序计算每个字段的 `wireOffset`
5. **CRC Extra 计算**：
   ```
   crc = crc_over(messageName + ' ')
   for each non-extension field:
     crc = crc_over(baseType + ' ')
     crc = crc_over(name + ' ')
     if arrayLength > 1: crc = crc_over(arrayLength)
   crc_extra = (crc & 0xFF) ^ (crc >> 8)
   ```

**输出 JSON 格式**：
```json
{
  "schema_version": 1,
  "dialect": "common",
  "enums": [...],
  "messages": [...]
}
```

**测试验证点**：
- HEARTBEAT 的 crc_extra = 50
- 字段重排序、偏移计算、扩展字段放置
- include 解析、缺失文件错误处理

---

## 测试文件

| 测试文件 | 覆盖内容 |
|---------|---------|
| `crc.test.ts` | 标准测试向量 "123456789" → `0x6F91`，增量 vs 批量累积，reset，calculateFrameCrc |
| `registry.test.ts` | 加载 common 方言，>200 消息，HEARTBEAT/ATTITUDE 元数据，双向查找，枚举解析 |
| `decoder.test.ts` | HEARTBEAT、ATTITUDE 解码，zero-trim，char[]→string，数值数组，未知 ID |
| `frame-parser.test.ts` | builder→parser 端到端，逐字节/块 feeding，坏 CRC 拒绝，未知 ID，拼接帧，垃圾恢复，float 帧 |
| `xml-parser.test.ts` | 最小 XML 解析，JSON 结构，CRC extra 计算，字段排序，偏移计算，include 解析，错误处理 |

---

## 模块依赖图

```
xml-parser.ts ──(生成 JSON)──→ registry.ts
                                   ↓
frame-parser.ts ←──(crcExtra, 消息查找)──┤
                                   ↓
decoder.ts ←──(字段布局)───────────┤
                                   ↓
frame-builder.ts ←──(元数据)───────┘
       ↑
   crc.ts (被 parser, builder, xml-parser 共享)

frame.ts (被所有帧相关模块共享)
metadata.ts (被 registry, decoder, builder, xml-parser 共享)
```
