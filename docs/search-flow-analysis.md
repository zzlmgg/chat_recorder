# Web 搜索执行路径分析（session-4335029c-2889-4ad6-8268-e9d9f963a0a5）

> 分析对象：`.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/` 下的录制产物
> 分析日期：2026-08-31
> 结论先行：**搜索由 model-api 在服务器端完成并总结**（即"选项 1"）。整个记录中不存在任何 curl / wget 指令。

## 1. 结论

当模型需要搜索网络信息时，实际执行路径是：

```text
harness ──tool_use WebSearch──▶ model-api ──▶ 上游模型（deepseek-v4-flash）
                                  │
                                  ├─ 服务器端执行搜索（server_tool_use + web_search_tool_result）
                                  ├─ 模型总结搜索结果（text）
                                  ▼
harness ──tool_result 回流──────┘
```

- **搜索动作**：由 model-api 服务器端完成（响应流中的 `server_tool_use`、`web_search_tool_result` 自定义内容块为直接证据）。
- **总结动作**：同样由 model-api 侧完成（响应流末尾的 `text` 块即完整的总结答案）。
- **harness 的角色**：模型发出 `tool_use WebSearch` 后，harness **并不执行搜索**，而是把查询转成一个纯文本请求（`"Perform a web search for the query: <query>"`）再发给 model-api；拿到服务端搜索结果与总结后，把 `web_search_tool_result` 重写为标准 `tool_result` 挂回原 `tool_use` 的 id，继续对话。

## 2. 记录概况

| 项 | 值 |
| --- | --- |
| 会话 ID | `4335029c-2889-4ad6-8268-e9d9f963a0a5` |
| 录制目录 | `.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/` |
| Exchange 数量 | 12（exchange-000001 ~ exchange-000012） |
| 时间范围 | 2026-08-24 00:03 ~ 00:10 |
| 模型 | `deepseek-v4-flash` |
| harness | claude-cli/2.1.238（`User-Agent: claude-cli/2.1.238 (external, cli)`） |
| 数据路径 | `Harness → Recorder(/v1/messages) → Model(/anthropic/v1/messages)` |
| 录制产物 | 每个 exchange 有 `request.body` / `request.json` / `response.body` / `response.json` / `upstream-request.json`，另有 `pretty/md`、`pretty/json` 重排版 |

本会话中模型共发出 **2 次** `tool_use WebSearch`：

| 搜索 | 发起 exchange | 查询 | 服务端执行 exchange | 结果回流 exchange |
| --- | --- | --- | --- | --- |
| 1 | exchange-000003 | `日本首相 现任 2026` | exchange-000004 | exchange-000005（其后在 000011/000012 持续携带） |
| 2 | exchange-000009 | `高市早苗 简历 履历 出生 教育 议员 大臣 经历` | exchange-000010 | exchange-000011（其后在 000012 持续携带） |

## 3. 完整时序（以搜索 1 为例）

### 3.1 exchange-000003：模型发出 WebSearch 调用

**request**：harness 将完整对话（用户提问"我想查一下现在的日本首相是谁？"）发给 model-api。

**response**（assistant 消息）：唯一的工具调用

```json
{
  "type": "tool_use",
  "id": "call_00_t3A0J3HfffslMU0y62Sx8853",
  "name": "WebSearch",
  "input": { "query": "日本首相 现任 2026" }
}
```

### 3.2 exchange-000004：harness 不执行搜索，转发为文本指令

**request**：harness 向 model-api 发出一个**全新请求**（非原对话续接）：

```json
{
  "model": "deepseek-v4-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Perform a web search for the query: 日本首相 现任 2026" }
      ]
    }
  ],
  "tools": [ ...仅 1 个工具... ]
}
```

特征：`messages` 只有 1 条（纯文本，无历史、无 tool_result）；`tools` 只有 1 个；请求头仍是 `claude-cli`、同一会话 ID —— 说明该请求由 harness 发起，是 harness 侧 WebSearch 工具"执行"的实现方式（把查询翻译成一句话问 model-api）。

**response**（流式 SSE，含自定义内容块，按出现顺序）：

| 内容块类型 | 内容 | 说明 |
| --- | --- | --- |
| `thinking` | — | 推理 |
| **`server_tool_use`** | `{"query": "日本首相 现任 2026"}` | **model-api 服务器端自己的工具调用**（非标准 Anthropic API 块） |
| **`web_search_tool_result`** | 约 15 KB 搜索结果 | **服务端真实搜索的原始结果**（非标准块） |
| `thinking` | — | 推理 |
| `text` | 总结答案（423 字符） | **模型对搜索结果的总结** |

`web_search_tool_result` 结构（节选）：

```json
{
  "type": "web_search_tool_result",
  "tool_use_id": "call_00_qHSxPk2MGDbxwG6zE7UP7648",
  "content": [
    {
      "type": "web_search_result",
      "title": "Primera ministra japonesa considera reorganización ejecutiva de PLD a finales de septiembre, informan medios",
      "url": "http://spanish.xinhuanet.com/20260822/2640c3925761484f9d65315768f302a8/c.html",
      "encrypted_content": "<加密正文>",
      "page_age": null
    },
    { "type": "web_search_result", "title": "...", "url": "...", "encrypted_content": "...", "page_age": null }
    // ... 多条
  ]
}
```

`text` 总结答案（节选）：

> 根据搜索结果显示，2026年日本的现任首相是**高市早苗（Sanae Takaichi）**。主要信息如下：- **就任经过**：高市早苗于2025年10月4日当选自民党总裁…- **2026年动向**：…- **执政状况**：2026年7月的多项民调显示…

### 3.3 exchange-000005：搜索结果回流为标准 tool_result

**request**：harness 将对话续接发回 model-api，其中包含：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "call_00_t3A0J3HfffslMU0y62Sx8853",
      "content": "Web search results for query: \"日本首相 现任 2026\"  Links: [{\"title\":\"...\",\"url\":\"...\"}, ...]"
    }
  ]
}
```

要点：

- `tool_use_id` **不是**服务端返回的 `call_00_qHSxPk2MGDbxwG6zE7UP7648`，而是模型最初发出的 `call_00_t3A0J3HfffslMU0y62Sx8853` —— harness 做了 **id 映射**。
- 内容被重写为 `Web search results for query: "<query>" Links: [{title,url}, ...]` 格式（2184 字符），即只保留服务端结果的标题与 URL，正文（`encrypted_content`）未回流。

## 4. 搜索 2 的验证（同模式复现）

exchange-000009 → 000010 → 000011 逐字复现同一模式：

1. **000009 response**：`[text]`"好的，我先补充搜索一下高市早苗的详细履历信息，然后保存到工作目录。" + `tool_use WebSearch {"query": "高市早苗 简历 履历 出生 教育 议员 大臣 经历"}`（id=`call_00_XUI0yegB93g1tla9YaUS5096`）。
2. **000010 request**：全新单消息请求 `"Perform a web search for the query: 高市早苗 简历 履历 出生 教育 议员 大臣 经历"`。
3. **000010 response**：同样包含 `server_tool_use`（`{"query": "高市早苗 简历 履历..."}`）+ `web_search_tool_result`（约 51 KB，服务端 tool_use_id=`call_00_9WExAMReAsRobLgDBfnm6293`）+ `text`（1,124 字符的完整履历总结："# 高市早苗简历与履历 ## 出生与家庭背景 …"）。
4. **000011 request**：两个 WebSearch 的 `tool_result`（2184 字符 + 2625 字符）以 `Links: [...]` 格式回流；同时该 response 还发出了 `tool_use Write`（保存履历文件），对应 000012 中的第三个 `tool_result`（`File created successfully at: .../日本首相高市早苗履历.md`）—— 与搜索路径无关。

## 5. 判定依据汇总

| # | 证据 | 说明 |
| --- | --- | --- |
| A | **无 curl / wget** | 全记录中 "curl" 只出现在 Bash/Monitor 工具的描述文本（示例命令）里，模型从未输出 curl 指令，harness 也从未执行过 curl —— 排除"选项 2"。 |
| B | **tool_use 后无 harness 侧搜索结果** | WebSearch 发出后的下一个请求（000004 / 000010）中**没有** harness 填充的 `tool_result`，取而代之的是纯文本指令请求。 |
| C | **服务端自定义块** | `server_tool_use` + `web_search_tool_result` 是非标准内容块，带 `encrypted_content`（服务端搜索服务的返回格式），是 model-api 服务器端搜索的直接证据。 |
| D | **总结在服务端完成** | 响应流的 `text` 块已是完整总结答案（含具体事实），harness 拿到后直接使用，无需二次请求总结。 |
| E | **结果回流格式** | 回流 `tool_result` 的 `tool_use_id` 被映射回模型最初发出的 id，内容被重写为 `Links: [...]`（仅标题+URL）。 |

## 6. 实现细节与边界

- **两套 tool_use_id**：服务端 `web_search_tool_result.tool_use_id`（如 `call_00_qHSxPk2MGDbxwG6zE7UP7648`）与 harness 侧模型发出的 id（如 `call_00_t3A0J3HfffslMU0y62Sx8853`）不同，harness 以模型发出的 id 挂回 `tool_result`。
- **格式重写**：服务端返回 `web_search_result`（title/url/encrypted_content/page_age），harness 侧重写为 `Web search results for query: "..." Links: [{title,url}, ...]` 纯文本。
- **正文不回传**：`encrypted_content`（加密正文）不进入对话上下文，只回传标题与 URL。
- **搜索 2 的请求文本以英文发问**（"Perform a web search for the query: 高市早苗 简历 履历..."），但服务端搜索与总结均以中文内容完成。
- 本记录未覆盖 WebFetch / Bash 等其他工具路径；本分析仅针对 WebSearch。

## 7. 复现与验证命令

```bash
R=.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5

# 1) 模型发出的 WebSearch 调用（仅 2 次）
grep -o '"name":"WebSearch"' $R/exchange-*/response.body | sort | uniq -c

# 2) tool_use 后下一个请求无 tool_result（000004 / 000010 均只有 1 条文本消息）
python3 -c "import json;print([m['role'] for m in json.load(open('$R/exchange-000004/request.body'))['messages']])"

# 3) 服务端自定义块（server_tool_use / web_search_tool_result）
grep -o '"type":"[a-z_]*"' $R/exchange-000004/response.body | sort | uniq -c

# 4) 回流 tool_result 的内容与 id 映射
grep -o 'Web search results for query[^\\]*' $R/exchange-000005/request.body | head -c 300

# 5) 确认全记录无 curl / wget 指令（排除选项 2）
grep -rn -i 'curl\|wget' $R/pretty/md/ | grep -v '工具描述\|tool description\|示例' | head
```
