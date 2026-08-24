# exchange 文件夹中 request 与 response 的内容含义

研究日期：2026-08-24
研究对象：`.recordings/` 数据目录与 `src/` 源码，以 `session-4335029c-2889-4ad6-8268-e9d9f963a0a5` 为例
主要来源：代码（`src/*.mjs`）、规格（`.scratch/faithful-recorder-design/spec.md` / `spec_cn.md`）、测试（`test/*.mjs`）、录制数据（`.recordings/`）本身

## 结论摘要

- `.recordings` 是「忠实的 Claude Code 模型交换记录器」的产物根目录。Recorder 是一个零依赖 Node.js HTTP/1.1 反向代理，把 Claude Code（CLI 或 VS Code 扩展）发给模型的每一个 `POST /v1/messages` 请求**逐字节**转发到上游（DeepSeek Anthropic 兼容网关），并把每次「请求 + 响应」作为一个 **Model Exchange** 原样落盘：JSON 与 SSE 从不被解析、规范化、脱敏或重新生成（README.md:1-9）。
- 每个 Model Exchange 占一个目录 `exchange-NNNNNN`，内含 5 个文件。其中 `request.json` 是**执行端（Harness）发出的应用层请求元数据**（起始行 + 有序保留重复的字段对 + 实体引用），`request.body` 是该请求的**原始字节实体**；`response.json` 是**模型（Model）返回的应用层响应元数据**（状态行 + 字段对 + 实体引用），`response.body` 是响应实体字节。另有 `upstream-request.json` 记录 Recorder 实际向上游发出的请求（审计用）。
- `request.json` 与 `response.json` 都是普通 JSON 对象，字段为：`http_version`、`method`/`status`+`reason`、`target`、`headers`（`[name, value]` 有序数组对）、`trailers`、`entity_file`。
- 一个 exchange 目录就是**配对边界**：同一编号目录下的 request 与 response 属于同一次 Model Exchange（spec.md:241）。目录编号即**请求头准入顺序**（从 `exchange-000001` 开始递增），与响应完成顺序无关（spec.md:171, 205）。产物不存任何时间戳（spec.md:243）。

## 1. 项目是什么：录什么、怎么组织

`README.md` 开门见山：这是一个「零依赖、独立运行的 Node.js HTTP/1.1 反向代理，忠实记录 Claude Code 与 DeepSeek 兼容上游之间的完整模型流量（Model Exchange）」，「把每一次交换的逐字节实体和完整 HTTP 元数据落盘」（README.md:1-5）。

数据路径（README.md:105-111）：
1. Claude Code（Harness）经 cc-switch 的 Recorder Profile 把 `ANTHROPIC_BASE_URL` 指向 Recorder 的 `127.0.0.1:4318`；
2. Recorder 校验会话锁定条件后，把请求原样转发到 `--upstream-base-url`（默认 `https://api.deepseek.com/anthropic`，README.md:53）；
3. 模型响应原样流式转回 Harness，同时 tee 一份落盘。

**会话锁定**：第一个满足条件的请求（`POST /v1/messages` 且恰好携带一个非空 `x-claude-code-session-id` 请求头）在请求头读完时锁定该 Harness Session，此后该会话的所有 Model Exchange 记入同一会话目录（README.md:107-108；实现见 `src/server.mjs:127-140` 的 `eligibleSessionId`、`src/server.mjs:32-40` 的加锁与准入）。不含/空/重复 session 字段的辅助流量（预热、token 计数等）只转发、不记录（README.md:108）。

**产物组织**（README.md:112-126）：

```
<output-root>/
└── session-<会话ID的可逆编码>/
    ├── index.json                        # artifact_version: 1, session_id, 按序的交换列表
    └── exchange-000001/
        ├── request.json                  # 源请求元数据（有序、保留重复的字段对）
        ├── request.body                  # 请求实体原始字节
        ├── upstream-request.json         # Recorder 实际发出的上游请求（可审计）
        ├── response.json                 # 模型响应元数据
        └── response.body                 # 响应实体原始字节
```

领域术语（Model Exchange、Harness Session、Recorder）定义见 `CONTEXT.md:13-17`：Model Exchange 是「Harness 发出的一个完整应用层模型 API 请求，连同 Model 返回的对应完整应用层响应，包括所有源发字段与精确实体字节序列」。

## 2. .recordings 目录全貌

`.recordings/` 下有三个会话目录（2026-08-23 至 08-24 的多次录制）：

- `session-4335029c-2889-4ad6-8268-e9d9f963a0a5/`：12 个交换（`exchange-000001` ～ `exchange-000012`）+ `index.json`
- `session-be38d737-cb9e-43ff-9837-08113b01651b/`：10 个交换
- `session-69d164d4-fc91-4754-9603-8224617a9c9d/`：5 个交换

会话目录名是 session ID 的可逆编码（UUID 形态保持原样，`src/artifact.mjs:70-83` 的 `encodeSessionComponent`）。目标会话的 `index.json`（`.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/index.json`）：

```json
{
  "artifact_version": 1,
  "session_id": "4335029c-2889-4ad6-8268-e9d9f963a0a5",
  "exchanges": [
    "exchange-000001", "...", "exchange-000012"
  ]
}
```

`exchanges` 数组按**准入顺序**列出目录名（`src/artifact.mjs:35-41` 的 `writeIndex`；spec.md:206-210）。`.recordings/` 被 `.gitignore` 忽略。

## 3. 一个 exchange 目录内的五个文件

以 `exchange-000001/` 为例，五个文件各自的来源与含义：

| 文件 | 内容 | 写入代码位置 | 规格定义 |
| --- | --- | --- | --- |
| `request.json` | Harness 发出的**应用层请求元数据**：起始行 + 有序、保留重复的 header/trailer 字段对 + 实体引用 | `src/server.mjs:41-48` 构造初始元数据；`src/artifact.mjs:27` 先落盘；`src/exchange.mjs:55` 在请求体结束后补写最终版（含源 trailers） | spec.md:212-219 |
| `request.body` | 请求实体**原始字节**（本例是 Messages API 的 JSON 请求体，138,761 字节） | `src/artifact.mjs:49-51` `createRequestBodySink`；`src/exchange.mjs:45-51` tee 转发 | spec.md:239（body 文件总是存在，零长度也建） |
| `upstream-request.json` | Recorder 实际向上游发出的请求元数据（join 后的 target、替换后的 Host、hop-by-hop 处理后字段） | `src/exchange.mjs:56-64` `writeUpstreamRequest` | spec.md:230-237 |
| `response.json` | 模型返回的**应用层响应元数据**：状态行 + 有序、保留重复的 header/trailer 字段对 + 实体引用 | `src/exchange.mjs:88-96` `writeResponse` | spec.md:221-228 |
| `response.body` | 响应实体**原始字节**（本例是 SSE 流，46,774 字节） | `src/artifact.mjs:53-55` `createResponseBodySink`；`src/exchange.mjs:79-85` tee 转发 | spec.md:239 |

JSON 文件的序列化格式：`JSON.stringify(value, null, 2)` + 换行（`src/artifact.mjs:85-87`），即人类可读的缩进 JSON。**所有 header/trailer 都以 `[name, value]` 二元数组（字段对）形式存放**，由 `rawFieldPairs` 从 Node 的 `rawHeaders`/`rawTrailers` 平铺数组成对切分得到（`src/exchange.mjs:168-174`）——保留原始大小写、跨字段顺序与重复字段（spec.md:42 用户故事；`test/request-envelope.test.mjs:123-130`、`test/response-envelope.test.mjs:101-108` 断言完整形状）。

## 4. request.json：字段逐解释

### 4.1 字段从哪里来

`src/server.mjs:41-48` 在请求头读完后构造初始元数据对象：

```js
const requestMetadata = {
  http_version: request.httpVersion,   // 例："1.1"
  method: request.method,              // 例："POST"
  target: request.url,                 // 例："/v1/messages?beta=true"（原样保留 query）
  headers: rawFieldPairs(request.rawHeaders),  // 有序、保留重复与原始大小写的字段对
  trailers: [],                        // 占位：请求体结束前 trailer 不可知
  entity_file: "request.body",         // 指向同目录实体文件
};
```

`src/server.mjs:32-40` 判定是否准入（`admitted`），准入则 `src/artifact.mjs:18-33` 的 `admit()` 创建 `exchange-NNNNNN` 目录并先行写入 `request.json`（目录编号即当前交换计数 +1，`src/artifact.mjs:19-20`）。请求体结束、源 trailer 已知后，`src/exchange.mjs:52-55` 把 `trailers: sourceTrailers` 并入后**重写** `request.json` 完成定稿（spec.md:232「源 trailer 元数据只有对应实体结束后才定稿」）。

### 4.2 逐字段含义（以 `exchange-000001/request.json` 为实例）

该文件全文 93 行（`.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/exchange-000001/request.json`），逐字段：

| 字段 | 值 | 含义与来源 |
| --- | --- | --- |
| `http_version`（:2） | `"1.1"` | Harness 请求的 HTTP 版本（Node `request.httpVersion`，`src/server.mjs:42`）。Recorder 只收 HTTP/1.1，其余 505（`src/server.mjs:16-19`）。 |
| `method`（:3） | `"POST"` | 请求方法（`src/server.mjs:43`）。被录的都是 POST。 |
| `target`（:4） | `"/v1/messages?beta=true"` | **原始请求目标**（RFC 9112 的 request-target / origin-form），即 Harness 发来的完整 `request.url`，含 query（`src/server.mjs:44`）。spec.md:214「preserving the original Harness request target」；查询串对准入不敏感但被保留（spec.md:24 用户故事）。 |
| `headers`（:5-90） | 22 对 `[name, value]` | **有序、保留重复、保留原始大小写**的请求字段对，直接来自 Harness 的 `rawHeaders`（`src/exchange.mjs:25`、`rawFieldPairs` `src/exchange.mjs:168-174`）。**记录的是源头完整字段**：包括 hop-by-hop 字段（`Connection: keep-alive` :75-77、`Host: 127.0.0.1:4318` :79-81，即 Recorder 自己的地址）、凭据（`Authorization: Bearer sk-...` :11-13，**不脱敏**，README.md:9 明言「录到的就是线上真实的字节」）、`X-Claude-Code-Session-Id`（:23-25，即本次会话锁定的身份）、`anthropic-beta` 能力列表（:59-61）、`anthropic-version`（:67-69）、Stainless SDK 元数据（:27-57）、`Accept-Encoding: gzip, deflate, br, zstd`（:83-85）、`Content-Length: 138761`（:87-89，与 `request.body` 字节数一致）。 |
| `trailers`（:91） | `[]` | 请求 trailer 字段对。本例 Harness 未发 trailer；有 trailer 时在此保留（测试见 `test/request-envelope.test.mjs:82-86, 128`）。 |
| `entity_file`（:92） | `"request.body"` | 实体字节所在文件名（同目录相对路径），把元数据与实体解耦并显式关联（spec.md:216-219）。 |

注意 `headers` 里的顺序就是 Harness 发来的**字节顺序**，重复字段会重复出现（例如 `test/request-envelope.test.mjs:69-81` 的 `X-Duplicate`/`x-DUPLICATE` 两对都保留）——这是「忠实记录」的核心承诺（spec.md:42 用户故事 42）。

## 5. response.json：字段逐解释

### 5.1 字段从哪里来

模型响应头到达时，`src/exchange.mjs:68-99` 处理响应：`responseHeaders = rawFieldPairs(modelResponse.rawHeaders)`（:69），实体 tee 转发（:79-85），实体结束后 `writeResponse`（:86-96）：

```js
await artifact.writeResponse({
  http_version: modelResponse.httpVersion,   // 例："1.1"
  status: modelResponse.statusCode,          // 例：200（数字）
  reason: modelResponse.statusMessage,       // 例："OK"
  headers: responseHeaders,                  // 有序、保留重复与原始大小写的字段对
  trailers: sourceTrailers,                  // 源 trailer
  entity_file: "response.body",
});
```

与请求侧不同，响应没有「先行落盘再定稿」：响应元数据在实体结束时一次写入（`src/artifact.mjs:65-67`）。与 `request.json` 不同的是响应记录 `status` + `reason`（数字状态码 + 原因短语）而不是 `method` + `target`（spec.md:221-228）。

### 5.2 逐字段含义（以 `exchange-000001/response.json` 为实例）

| 字段 | 值 | 含义与来源 |
| --- | --- | --- |
| `http_version`（:2） | `"1.1"` | 上游（模型网关）响应的 HTTP 版本（`modelResponse.httpVersion`，`src/exchange.mjs:89`）。 |
| `status`（:3） | `200` | 数字状态码（`src/exchange.mjs:90`）。 |
| `reason`（:4） | `"OK"` | 原因短语（`src/exchange.mjs:91`）。 |
| `headers`（:5-58） | 17 对 `[name, value]` | **模型侧响应头的完整、有序、保留重复的字段对**，来自上游 `rawHeaders`（`src/exchange.mjs:69`）。注意这里**包含** hop-by-hop 字段：`Transfer-Encoding: chunked`（:39-41）、`Connection: keep-alive`（:43-45）——因为记录的是源头完整字段；转发给 Harness 时才按 hop-by-hop 规则移除（`src/exchange.mjs:70-77`）。端到端字段如 `Content-Type: text/event-stream; charset=utf-8`（:11-13）、`x-ds-trace-id`（:23-25）、`EO-LOG-UUID`/`EO-Cache-Status`（:51-57，DeepSeek 网关特有）、`Date: Sun, 23 Aug 2026 16:03:07 GMT`（:47-49）。 |
| `trailers`（:59） | `[]` | 响应 trailer。本例无（SSE 流未带 trailer）；有则保留（`src/exchange.mjs:93`，测试 `test/response-envelope.test.mjs:32-36, 106`）。 |
| `entity_file`（:60） | `"response.body"` | 响应实体字节所在文件名（spec.md:224-228）。 |

## 6. body 文件：实体的原始字节

- `request.body`：请求实体的**逐字节原样**副本，边转发边 tee 落盘（`src/exchange.mjs:45-51, 103-120` 的 `relayEntity` 分流转发）。文件内容就是 Harness 发出的 Messages API JSON 请求体。例（`exchange-000001/request.body` 开头）：

```json
{"model":"deepseek-v4-flash","messages":[{"role":"user","content":[{"type":"text","text":"<system-reminder>..."},{"type":"text","text":"你是什么模型？","cache_control":{"type":"ephemeral"}}]},{"role":"system","content":"Available agent types for the Agent tool:..."}]}
```

  这些 JSON 字段（`model`、`messages`、`system`、`tools`、`max_tokens`、`stream` 等）是 **Harness 自己的 Messages API 载荷**，Recorder 从不解析、不校验、不重写（README.md:5；spec.md:131「treats ... Messages body fields ... as open lists」）。`exchange-000002/request.body`（4,064 字节，小且完整）是一个「会话标题生成」请求，可看到 `output_config` 的 `json_schema` 结构化输出、`tools: []`、`metadata.user_id` 等字段。

- `response.body`：模型响应的**逐字节原样**副本，即 Harness 实际收到的 SSE 流。例（`exchange-000001/response.body` 开头与结尾）：

```
event: message_start
data: {"type":"message_start","message":{"id":"3f4cb393-...","model":"deepseek-v4-flash",...,"usage":{...}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking",...}}
...
event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"当前的"}}
...
event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn",...},"usage":{...}}

event: message_stop
data: {"type":"message_stop"}
```

  SSE 事件（`message_start`、`content_block_start`、`ping`、`content_block_delta`、`content_block_stop`、`message_delta`、`message_stop`）同样**逐字节**保留，包括 `thinking_delta` 的思考内容与 `text_delta` 的正文增量（spec.md:132「SSE event types as open lists」）。

## 7. 完整示例：exchange-000002 逐字段讲解

`exchange-000002` 是本会话中较小的一次交换（request.body 4,064 字节、response.body 10,383 字节），适合完整走读。它是一次**会话标题生成**请求（Claude Code 在会话开始时的小型结构化输出请求）。

**`request.json`**（`.recordings/.../exchange-000002/request.json`）——与 exchange-000001 同构：`http_version: "1.1"`（:2）、`method: "POST"`（:3）、`target: "/v1/messages?beta=true"`（:4）、`headers`（:5-89）21 对字段、`trailers: []`（:91）、`entity_file: "request.body"`（:92）。header 集合与 exchange-000001 几乎相同，**唯一实质差异是 `anthropic-beta` 值**（:59-61）多了 `structured-outputs-2025-12-15` —— 说明 headers 内容完全取决于 Harness 每次请求的实况，Recorder 只做旁观记录。

**`upstream-request.json`**（`.recordings/.../exchange-000002/upstream-request.json`）——与 request.json 的差异就是 Recorder「第二跳」造成的路由/逐跳改动（`src/exchange.mjs:52-64`）：
- `target` 变为 `"/anthropic/v1/messages?beta=true"`：上游 base URL `https://api.deepseek.com/anthropic` 的路径前缀与 Harness target 拼接（`src/exchange.mjs:24`、`joinTarget` `src/exchange.mjs:122-125`；spec.md:145-148）；
- `Host` 变为 `"api.deepseek.com"`（:75-77）：替换为上游 authority（`buildUpstreamHeaders` `src/exchange.mjs:127-145`，尤其 :133-134, :141）；
- `Connection: keep-alive` 移到字段列表末尾并强制保留（:87-89，`src/exchange.mjs:142`）；无 `Content-Length` 时补 `Transfer-Encoding: chunked`（:143）；
- 其余端到端字段（含 `Authorization`、`X-Claude-Code-Session-Id`、`anthropic-beta` 等）**原样**保留；请求时被移除的是 hop-by-hop 字段与 `Connection` 点名的字段（`src/exchange.mjs:26-31, 147-162`）；
- `entity_file` 仍指 `"request.body"`：与 request.json 共享同一实体文件，表达「字节一致且不存第二份拷贝」（spec.md:229, 236-237）。

**`response.json`**（`.recordings/.../exchange-000002/response.json`）：`http_version: "1.1"`（:2）、`status: 200`（:3）、`reason: "OK"`（:4）、`headers`（:5-58）17 对（与 exchange-000001 同构：`openresty`、`text/event-stream`、`x-ds-trace-id: 2d85a231...`、`EO-Cache-Status: MISS`、`Date: Sun, 23 Aug 2026 16:03:27 GMT` 等）、`trailers: []`（:59）、`entity_file: "response.body"`（:60）。

**`request.body`**（4,064 字节，JSON）：`{"model":"deepseek-v4-flash","messages":[{"role":"user","content":[{"type":"text","text":"<session>\n我想查一下现在的日本首相是谁？\n</session>\n\nWrite the title ..."}]}],"system":[{"type":"text","text":"x-anthropic-billing-header: ..."},{"type":"text","text":"You are Claude Code, ..."},{"type":"text","text":"You are naming a coding session ..."},{"type":"text","text":"Return JSON with a single \"title\" field. ..."}],"tools":[],"metadata":{"user_id":"{...\"session_id\":\"4335029c-...\"}"},"max_tokens":32000,"output_config":{"effort":"max","format":{"type":"json_schema","schema":{"type":"object","properties":{"title":{"type":"string"}},...}}},"stream":true}`

字段含义：`model` 模型名；`messages` 对话消息（user 消息内含 `<session>` 包裹的待命名内容）；`system` 系统提示（含 billing header 与标题生成指令，最后要求返回 JSON）；`tools` 空数组；`metadata` 用户/设备/会话元数据；`max_tokens`、`output_config`（结构化输出 json_schema，`effort: max`）、`stream: true` 请求流式。

**`response.body`**（10,383 字节，SSE）：`message_start`（usage 显示 input_tokens 817）→ `content_block_start`（thinking）→ 若干 `ping` 与 `content_block_delta`（`thinking_delta` 逐步输出英文思考：「The user asks in Chinese about who the current Prime Minister of Japan is...」）→ `content_block_start`（index 1，text）→ `content_block_delta`（`text_delta` 增量输出最终标题 JSON）→ `content_block_stop` → `message_delta`（`stop_reason: end_turn`，output_tokens 73）→ `message_stop`。

**两个 exchange 对照**（exchange-000001 vs 000002）：
- 000001 是真实对话轮（`messages` 含 system-reminder 与工具 schema），000002 是会话标题生成的辅助请求——**但都带同一个 `x-claude-code-session-id`，因此都属于锁定会话并都被记录**（README.md:108 只排除「缺少、为空或重复 session 字段」的请求）；
- 两者的 `request.json`/`response.json` 结构完全一致，`Content-Length` 均与 body 字节数精确相等（138,761 与 4,064）。

## 8. request 与 response 如何配对成一个 exchange

- **配对边界 = 目录**：同编号 `exchange-NNNNNN/` 目录下的元数据与 body 文件属于同一次 Model Exchange，「绝不能配对来自不同交换编号的元数据或 body 文件」（spec.md:241）。`request.json` 的 `entity_file: "request.body"`、`response.json` 的 `entity_file: "response.body"`、`upstream-request.json` 的 `entity_file: "request.body"` 都是对同目录文件的引用（spec.md:216-219, 224-228, 236-237）。
- **顺序 = 请求头准入顺序**：目录编号在请求头读完的瞬间分配（`src/artifact.mjs:19-20` 用「已接纳数 +1」编号），`index.json` 的 `exchanges` 数组按此顺序排列（`src/artifact.mjs:35-41`）。「交换顺序是请求头准入顺序，不是响应完成顺序、所有网络事件的挂钟顺序或 SSE 事件顺序」（spec.md:171）；即使并发交换响应乱序完成，index 顺序也不变（`test/admission-order.test.mjs`，spec.md:331）。
- **时间关系**：产物**不存任何时间戳**——「artifact stores no raw transfer framing, delivery-chunk log, **timing**, TCP/TLS data, ...」（spec.md:243），顺序只能由编号与 index 表达。`response.json` 头里的 `Date`（如 `Sun, 23 Aug 2026 16:03:07 GMT`）是上游模型网关生成响应时写的时间头，只是被忠实的字段记录，不是 Recorder 的录制时间；两个相邻 exchange 的 `Date` 相差约 20 秒，与本会话顺序执行的节奏一致，但不能作为排序依据（spec.md:63, 171）。
- **生命周期时序**（spec.md:232, 240「trigger-based persistence」；实现见 `src/artifact.mjs:18-33`、`src/exchange.mjs:52-65, 86-96`）：
  1. 请求头读完 → 准入：创建目录、写 `request.json` 初版、更新 `index.json`、打开 `request.body` sink；
  2. 请求体到达 → 边转发边写 `request.body`；请求体结束 → trailers 定稿，重写 `request.json`（最终版），写 `upstream-request.json`；
  3. 模型响应头到达 → 边转发边写 `response.body`；
  4. 响应实体结束 → 写 `response.json`（含源 trailers）。正常停止会等所有已准入交换完成此流程后才退出（README.md:92, `src/server.mjs:84-92`）。

## 9. request.json 与 upstream-request.json 的区别（为什么是两个文件）

`request.json` 记录的是 **Harness 侧事实**：Recorder 从 loopback 收到的原始请求（`target` 是 `/v1/messages?beta=true`，`Host` 是 `127.0.0.1:4318`，含 hop-by-hop 字段）；`upstream-request.json` 记录的是 **Recorder 实际发往 Model 的请求**：拼接 base 路径后的 target（`/anthropic/v1/messages?beta=true`）、替换后的上游 `Host`（`api.deepseek.com`）、按 hop-by-hop 规则处理后的字段（移除 `Connection` 点名的字段等）与强制 keep-alive（spec.md:145-148, 230-237；`src/exchange.mjs:24-31, 122-145, 147-162`；测试 `test/request-envelope.test.mjs:94-112, 131-138`）。两个文件让「代理第二跳造成的差异」可审计，同时通过共享 `entity_file: "request.body"` 表达字节一致（spec.md:229）。响应侧没有对应的「upstream-response.json」：转发路径对响应唯一的方向性改动是移除 hop-by-hop 字段（`src/exchange.mjs:70-77`），而 `response.json` 保留的是源头完整字段，差异可由 spec 的封闭规则推得（spec.md:152-155）。

## 10. 字段级定义的权威来源

| 来源 | 位置 | 内容 |
| --- | --- | --- |
| 规格（英文） | `.scratch/faithful-recorder-design/spec.md:189-243` | Artifact contract 全文：目录形状（:190-196）、编号（:205）、`index.json`（:206-210）、`request.json` 六字段（:212-219）、`response.json` 六字段（:221-228）、`upstream-request.json`（:230-237）、body 文件（:239）、配对边界（:241）、无时序（:243） |
| 规格（中文） | `.scratch/faithful-recorder-design/spec_cn.md:205-241` | 同一契约的中文版 |
| 原型说明 | `.scratch/faithful-recorder-design/prototypes/lossless-recording-artifact/README.md` | 最早的 synthetic 示例与每条设计理由 |
| 代码 | `src/artifact.mjs:18-41`（准入/索引）、`:44-67`（五个文件的写入）、`:70-87`（目录编码、JSON 序列化） | writer 实现 |
| 代码 | `src/server.mjs:41-48`（requestMetadata 构造）、`:127-140`（会话资格判定） | 元数据来源 |
| 代码 | `src/exchange.mjs:25, 52-65`（request 定稿与 upstream 元数据）、`:68-99`（response 处理与 `writeResponse`）、`:103-120`（tee 转发）、`:122-145, 147-162`（目标拼接与 hop-by-hop 处理）、`:168-174`（`rawFieldPairs`） | 字段值来源与第二跳差异 |
| 测试 | `test/request-envelope.test.mjs:123-138` | `request.json`/`upstream-request.json` 的精确形状断言（含重复字段、trailers） |
| 测试 | `test/response-envelope.test.mjs:101-108` | `response.json` 的精确形状断言 |
| 测试 | `test/admission-order.test.mjs` | 准入顺序契约（spec.md:331） |
| README | `README.md:105-126` | 工作原理与产物格式简表 |

## 11. 引用的数据文件（.recordings）

- `.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/index.json` — 会话索引（12 个交换）
- `.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/exchange-000001/{request.json, request.body, upstream-request.json, response.json, response.body}` — 完整示例 1（真实对话轮）
- `.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/exchange-000002/{request.json, request.body, upstream-request.json, response.json, response.body}` — 完整示例 2（标题生成轮，body 较小）
- `.recordings/session-be38d737-.../index.json`、`.recordings/session-69d164d4-.../index.json` — 其余会话布局对照

> 注意：`.recordings` 含真实对话与凭据（`Authorization` 头、system 内容、thinking 数据均原样落盘，spec.md:45 用户故事 45），引用时仅做解释性说明，不应扩散原文。
