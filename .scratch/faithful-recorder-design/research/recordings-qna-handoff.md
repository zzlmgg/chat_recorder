# 会话交接：.recordings 数据理解问答（新人继续点）

交接日期：2026-08-24
面向对象：后续接手"理解 `.recordings` 录制产物、与 model-api（DeepSeek Anthropic 兼容端点）交互机制"工作的新人。
说明：本文件整理的是**用户咨询的问题与已确认的答案**；深度论证与逐字段出处见 [recordings-exchange-request-response-format.md](recordings-exchange-request-response-format.md)（研究笔记，本目录已有），本文件不重复其内容，只做索引和速览。

## 1. 会话背景

用户在研究 chat-recorder（零依赖 Node.js 反向代理，忠实记录 Claude Code ↔ DeepSeek 网关的模型流量）录到的 `.recordings` 数据，逐步问清了：exchange 文件的含义、request/response 的语义、Recorder 的转发不对称设计、model-api 的无记忆特性、主/辅轮区分方法，最终目标是**估算/实测 model-api 能接收的上下文输入上限**。

## 2. 已解答的问题清单

| # | 用户的问题 | 一句话答案 | 详细出处 |
| --- | --- | --- | --- |
| 1 | exchange 文件夹中 request 和 response 内容分别是什么意思 | 一个 exchange = 一次 `POST /v1/messages` 调用的完整记录：`request.json/body` = Harness→Recorder 的请求（元数据 + 原始字节），`response.json/body` = Model→Recorder 的响应（元数据 + SSE 流），`upstream-request.json` = Recorder→Model 的实际第二跳 | 研究笔记全文 |
| 2 | request/response body 挤在一起，整理可读排版 | 已生成 [pretty/](.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/pretty/index.md) 可读版，布局：`pretty/index.md`（索引）+ `pretty/md/`（12 个 exchange 的 md，request=整体 JSON 缩进、response=SSE 按事件分节，头部含「顶层 key 速览」表）+ `pretty/json/`（每 exchange 一个合并文件：`{"request": …, "response": [事件数组]} `——`<ex>.json` 为标准 JSON 供折叠查看；`<ex>.json5` 为换行展示版，字符串内 `\n` 展开为真实换行，需 VSCode JSON5 扩展）。注意：md 内曾尝试 `\n` 展开**已回退**——md/ 保持严格 JSON，但 json5 文件里展开是**用户确认要的**，两者不冲突 | 本文件附录 A（再生成脚本） |
| 3 | 对 api-model 来说 request body 哪些必须给？哪些是真正输入 | API 必填仅 `model`+`messages`+`max_tokens`；真正进模型上下文的只有 `messages`/`system`/`tools`；`metadata`/`cache_control`/`context_management` 等是附注或控制参数，DeepSeek 对多数直接忽略 | 研究笔记 §4-6；DeepSeek 官方文档（见下） |
| 4 | request 的 body 和 json 文件有何关联和区别 | `request.json` 是信封（HTTP 起始行+头部+trailers，`entity_file` 引用 body），`request.body` 是信件（原始实体字节）；`Content-Length` 与 body 字节数精确相等；json 先写初版、body 结束后定稿，body 边转发边 tee 落盘 | 研究笔记 §3-4、§8；[src/exchange.mjs:52-55](src/exchange.mjs#L52-L55)、[src/artifact.mjs:18-33](src/artifact.mjs#L18-L33) |
| 5 | request 是 harness→model，response 是 model→harness 吗 | 方向对，但 request 记录的是 Harness→Recorder 那一跳（Recorder→Model 单独记在 `upstream-request.json`）；response 记录的是 Model→Recorder 源头，Recorder→Harness 未落盘 | 研究笔记 §9 |
| 6 | Recorder→harness 的信息在哪里 | 没有单独文件：body 逐字节相同（tee），headers = `response.json` 全量源头字段 − hop-by-hop 字段，差异可由 spec 封闭规则推出 | [src/exchange.mjs:68-85](src/exchange.mjs#L68-L85)；[spec.md:152-155](.scratch/faithful-recorder-design/spec.md#L152-L155) |
| 7 | model→recorder 是否有单独落盘文件 | 有——`response.json`+`response.body` 本身就是 Model→Recorder 源头视角的记录；不存在 `upstream-response.json` | 研究笔记 §9 |
| 8 | response.json+body 不是 Model→Recorder→Harness 整个吗 | body 是（同一份字节流）；headers 不是（`response.json` 是源头全量，Harness 收到的是去掉 hop-by-hop 的子集） | 同上 |
| 9 | 为什么响应侧不对称？缺 `Transfer-Encoding: chunked`/`Connection: keep-alive` 对 harness 有影响吗 | 请求侧第二跳依赖运行配置（base URL）不可推导故显式记录；响应侧第二跳是纯函数可推导故不记录。缺 hop-by-hop 头对 harness 零影响且是 HTTP/1.1 强制行为（Node 转发时自动重新 chunked） | [spec.md:152-155](.scratch/faithful-recorder-design/spec.md#L152-L155)、[spec.md:243](.scratch/faithful-recorder-design/spec.md#L243) |
| 10 | body 本质上是 json 吗 | `request.body` 是（完整 JSON 文档，单行压缩）；`response.body` 不是（SSE 流，每个 `data:` 行是独立 JSON，整文件不能整体 parse） | 研究笔记 §6 |
| 11 | 请求是整段编排一次性推理，响应是 SSE 流式返回？ | 对；补充：请求是**单次调用**的完整输入（agent 一轮工作 = 多个 exchange 串联），SSE 是因为请求里 `stream: true`（12/12），非 API 固有形态 | 研究笔记 §8；token 表见 §4 |
| 12 | api-model 没有记忆？harness 每次完整重发历史？ | 都对：主链 messages 数 2→14 逐轮累积，网关自动缓存命中（`cache_read>0`）反证前缀字节一致重发；`cache_read` 是 DeepSeek 自动缓存，不是模型记忆 | 本文件 §4 |
| 13 | 辅助轮不重发全量历史，无记忆模型能答对吗 | 能——辅助请求（标题生成/搜索）的任务本身不需要历史，请求内容自包含（`<session>` 标签、查询字符串即全部所需）；模型正确性 = 请求自包含性，上下文组装是 harness 的职责 | exchange-2/4/10 实测 |
| 14 | 怎么区分主对话轮和辅助轮？body 有显式标记吗 | **没有显式标记**（Recorder 不解析 body，spec 开放列表承诺）；靠内容启发式：`tools` 数（主=32 全量 / 标题=0 / 搜索=1）、`messages` 数（主≥2 / 辅=1）、user 首文本（主=`<system-reminder>` 开头 / 标题=`<session>`+Write the title / 搜索=`Perform a web search...`）、`output_config.format`（仅标题轮有 json_schema）、`anthropic-beta` 头（仅标题轮多 `structured-outputs-2025-12-15`） | 本文件 §4 特征表 |
| 15 | 每轮请求等效 token 数？上下文上限多少 | 主链 34,044→39,979 tokens（第 12 轮最大），全部 HTTP 200；官方上下文窗口 **1M tokens**（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)），40k 仅 4%；**实测上限需要合成探测请求**，未做 | 本文件 §4 表格 |

## 3. 核心结论速览（新人先读这 6 条）

1. **数据路径**：Claude Code → cc-switch Recorder Profile → Recorder(127.0.0.1:4318) → DeepSeek 网关 `https://api.deepseek.com/anthropic`；Recorder 逐字节转发 + tee 落盘，从不解析/改写 body。
2. **一个 exchange = 5 个文件**：`request.json`（Harness 侧请求元数据）+ `request.body`（请求实体字节）+ `upstream-request.json`（Recorder 实际第二跳，共享同一 request.body）+ `response.json`（Model 侧响应元数据，源头全量字段）+ `response.body`（SSE 实体字节）。目录编号 = 请求头准入顺序；产物无时间戳。
3. **不对称设计**：请求侧两跳都记录（第二跳依赖配置、不可推导）；响应侧只记源头（第二跳 = 源头 − hop-by-hop，可推导）。
4. **model 无记忆**：每次请求自包含；harness 主对话轮重发全量累积历史（含 tool_use/tool_result/thinking 块），辅助轮只带任务所需。任何"记忆感"都来自重发历史。
5. **无显式类型标记**：主/辅轮区分只能靠内容启发式（见 Q14 特征表）。
6. **token 统计**：网关 usage 是权威口径（总输入 = `input_tokens + cache_read_input_tokens`）；本会话最大 ~40k。

## 4. 关键数据（已从录制数据提取，可直接复用）

**每轮请求等效 token（网关 usage 报告，`message_start` 事件）：**

| exchange | 类型 | body 字节 | input | cache_read | 总输入 | output | stop |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 主 | 138,761 | 34,044 | 0 | 34,044 | 366 | end_turn |
| 2 | 标题 | 4,064 | 817 | 0 | 817 | 73 | end_turn |
| 3 | 主 | 140,626 | 118 | 34,304 | 34,422 | 106 | tool_use |
| 4 | 搜索 | 787 | 392 | 0 | 392 | 715 | end_turn |
| 5 | 主 | 144,491 | 1,136 | 34,432 | 35,568 | 604 | end_turn |
| 6 | 主 | 147,884 | 398 | 36,096 | 36,494 | 101 | end_turn |
| 7 | 主 | 146,502 | 86 | 36,096 | 36,182 | 110 | end_turn |
| 8 | 主 | 148,568 | 390 | 36,224 | 36,614 | 144 | end_turn |
| 9 | 主 | 147,239 | 91 | 36,224 | 36,315 | 183 | tool_use |
| 10 | 搜索 | 824 | 404 | 0 | 404 | 1,535 | end_turn |
| 11 | 主 | 153,507 | 1,495 | 36,480 | 37,975 | 1,951 | tool_use |
| 12 | 主 | 160,636 | 171 | 39,808 | 39,979 | 202 | end_turn |

观察：约 34k 是固定前缀（system+32 工具+早期历史），每轮新增仅 86–1,495 tokens；`cache_creation` 全程 0；`cache_read>0` 是 DeepSeek 网关自动缓存（非 harness 的 `cache_control`，官方标注 Ignored）。

**主/辅轮区分特征（本 session 12 轮实测 100% 有效）：** `tools` 大小（32/0/1）、`messages` 数（≥2/1）、user 首文本（`<system-reminder>`/`<session>`/`Perform a web search`）、`output_config.format`（仅标题轮 json_schema）、`anthropic-beta`（仅标题轮含 `structured-outputs-2025-12-15`）。注意：响应含 tool_use **不能**区分主/辅（主轮也有纯文本回答）。

## 5. 待办 / 可继续的事项

- **【用户目标】实测上下文上限**：官方口径 1M tokens；12 轮只证明 ≥40k。需合成探测请求（递增填充文本塞入 `messages`/`system`，观察 `context_length_exceeded` 错误点）。已提议写探测脚本，**用户未确认**——不要擅自消耗 API 额度，先问。
- **pretty/ 再生成**：`pretty/` 目录由脚本生成，脚本原在 /tmp（会被清理），已复制到本文件附录 A；如需重生成（例如新增 session），用附录脚本改路径即可。
- **已回退**：pretty/ 曾按用户要求把字符串内 `\n` 展开为真实换行（展示版），用户试用后**要求恢复**（2026-08-24）——现保持严格 JSON，`\n` 保持转义；除非用户再次要求，不要再做 `\n` 展开。
- **用户明确拒绝过**：主/辅轮自动分类脚本（不需要）——除非用户再次要求，不要做。

## 6. 敏感信息警告

- `.recordings/` 含真实数据：`request.json` headers 里有 `Authorization: Bearer sk-...`（API 密钥），还有真实对话、system 提示、thinking 内容。**引用时只做解释性说明，不扩散原文**；`.recordings/` 已被 `.gitignore` 忽略，注意不要取消忽略。
- 本文件与研究笔记只存路径引用和统计数字，不复制敏感原文。

## 7. 建议技能（新 agent 用 Skill 工具调用）

- `research`：继续做数据/源码调查类问题时使用（本文档与研究报告就是这么来的；报告落在 `.scratch/faithful-recorder-design/research/`）。
- `claude-api`：涉及 Messages API / DeepSeek Anthropic 兼容端点的字段语义、必填参数、模型能力时先加载（Q3/Q15 曾用它核实）。
- `run`：如果要实际启动 Recorder 或跑探测脚本验证行为时使用。
- `codebase-design` / `domain-modeling`：如果后续要把"主/辅轮识别"或"token 统计"固化成工具或文档时考虑。

## 8. 相关文件索引

| 路径 | 内容 |
| --- | --- |
| [recordings-exchange-request-response-format.md](recordings-exchange-request-response-format.md) | 研究笔记：exchange 文件逐字段含义、配对/顺序、生命周期（本文档的深度版） |
| [spec.md](.scratch/faithful-recorder-design/spec.md)（189-243 为 Artifact contract，152-155 为封闭规则，243 为无时序/framing 承诺） | 设计规格（英文） |
| [spec_cn.md](.scratch/faithful-recorder-design/spec_cn.md)（205-241） | 规格中文版 |
| [pretty/index.md](.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/pretty/index.md) | 12 个 exchange 的 body 可读排版（request=JSON 缩进，response=SSE 分节） |
| [.recordings/session-4335029c-…/exchange-000001/](.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5/exchange-000001/) | 示例 exchange（000002 是标题生成轮、000004/000010 是搜索轮，body 小适合走读） |
| [src/exchange.mjs](src/exchange.mjs)（52-65 请求定稿、68-99 响应处理、103-120 tee、168-174 rawFieldPairs） | Recorder 核心逻辑 |
| [src/server.mjs](src/server.mjs)（41-48 请求元数据、127-140 会话锁定） | 元数据来源 |
| [src/artifact.mjs](src/artifact.mjs)（18-33 准入、44-67 五个文件写入） | writer 实现 |

## 附录 A：pretty/ 再生成脚本

`pretty/` 目录由下列脚本生成（曾放 /tmp，随会话清理，此处留存）。用法：改 `SESSION` 路径后 `python3 脚本`，产物写入 `pretty/`（index.md + exchange-NNNNNN.md），内容与原始 body 逐字段一致（已用 JSON 解析校验）。

```python
#!/usr/bin/env python3
"""把 session 各 exchange 的 request.body / response.body 重排为可读 Markdown（内容不变）。"""
import json, pathlib

SESSION = pathlib.Path("/home/xuemingjun/Projects/chat_recorder/.recordings/session-4335029c-2889-4ad6-8268-e9d9f963a0a5")
OUT = SESSION / "pretty"
OUT.mkdir(exist_ok=True)
MD = OUT / "md"
MD.mkdir(exist_ok=True)

def pretty_json(s: str) -> str:
    try:
        return json.dumps(json.loads(s), ensure_ascii=False, indent=2)
    except json.JSONDecodeError:
        return s  # 非 JSON 内容原样保留

def format_request_body(s: str) -> str:
    return pretty_json(s)

def format_response_body(s: str) -> str:
    out = []
    for block in s.split("\n\n"):
        if not block.strip():
            continue
        for line in block.splitlines():
            if line.startswith("data:"):
                out.append("data: " + pretty_json(line[len("data:"):].strip()))
            else:
                out.append(line)
        out.append("")  # 空行分隔事件
    return "\n".join(out).rstrip() + "\n"

_ESCAPE = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\r': '\\r', '\t': '\\t'}

def _fmt_str(s: str) -> str:
    """JSON5 字符串转义：真正的换行以真实换行呈现（字面 \\n 内容仍保持 \\n 转义）。"""
    out = ['"']
    for ch in s:
        if ch == '\n':
            out.append('\n')               # 真实换行（JSON5 允许）
        elif ch in _ESCAPE:
            out.append(_ESCAPE[ch])
        elif ord(ch) < 0x20:
            out.append('\\u%04x' % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)

def dumps_json5(obj, indent=2):
    """JSON5 序列化：字典保序、字符串内 \n 展开为真实换行（内容不变，仅为展示）。"""
    def enc(o, level):
        pad = ' ' * (indent * level)
        if isinstance(o, dict):
            if not o: return '{}'
            items = [f'{pad}  {_fmt_str(str(k))}: {enc(v, level + 1)}' for k, v in o.items()]
            return '{\n' + ',\n'.join(items) + '\n' + pad + '}'
        if isinstance(o, list):
            if not o: return '[]'
            items = [f'{pad}  {enc(v, level + 1)}' for v in o]
            return '[\n' + ',\n'.join(items) + '\n' + pad + ']'
        if isinstance(o, str): return _fmt_str(o)
        if o is True: return 'true'
        if o is False: return 'false'
        if o is None: return 'null'
        if isinstance(o, (int, float)): return json.dumps(o)
        return json.dumps(o, ensure_ascii=False)
    return enc(obj, 0)

KEY_ORDER = ["model", "messages", "system", "tools", "max_tokens", "metadata",
             "output_config", "stream", "thinking", "context_management", "tool_choice"]

def key_summary(k: str, v):
    """每个顶层 key 的一行值形态说明（用于速览表）。"""
    if v is None:
        return "null（此轮未启用）"
    if k == "model": return f"str: {v}"
    if k == "max_tokens": return f"int: {v}"
    if k == "stream": return f"bool: {v}"
    if k == "messages":
        roles = {}
        for m in v:
            roles[m.get("role")] = roles.get(m.get("role"), 0) + 1
        return f"list[{len(v)}]: " + ", ".join(f"{r}×{n}" for r, n in roles.items())
    if k == "system":
        kinds = [b.get("type") for b in v if isinstance(b, dict)]
        return f"list[{len(v)}]: {kinds}"
    if k == "tools":
        if not v: return "list[0]: 无工具"
        names = [t.get("name", t.get("type")) for t in v]
        return f"list[{len(v)}]: " + ", ".join(str(n) for n in names[:4]) + ("…" if len(v) > 4 else "")
    if k == "metadata": return "dict: user_id（内嵌 device_id/account_uuid/session_id）"
    if k == "output_config":
        parts = [f"effort={v.get('effort')}"]
        if v.get("format"): parts.append("format=json_schema")
        return "dict: " + ", ".join(parts)
    if k == "thinking": return "dict: adaptive" if v else "null（此轮未启用）"
    if k == "context_management":
        return "dict: edits[clear_thinking]" if v else "null（此轮未启用）"
    if k == "tool_choice": return f"dict: {v.get('type')}"
    return json.dumps(v, ensure_ascii=False)[:60]

index_lines = ["# " + SESSION.name + " — 可读版", "",
               "内容与原始 request.body / response.body 完全一致，仅重新排版（JSON 缩进、SSE 逐事件分节）。",
               "原始文件在各 exchange 文件夹中；本目录由脚本生成，可随时删除后重新生成。", ""]
for ex in sorted(p.name for p in SESSION.glob("exchange-*")):
    edir = SESSION / ex
    req_b = (edir / "request.body").read_text(encoding="utf-8")
    resp_b = (edir / "response.body").read_text(encoding="utf-8")
    summary = ""
    try:
        rj = json.loads((edir / "request.json").read_text(encoding="utf-8"))
        rp = json.loads((edir / "response.json").read_text(encoding="utf-8"))
        summary = f" `{rj['method']} {rj['target']}` → HTTP {rp.get('status', '?')}"
    except Exception:
        pass
    md = [f"# {ex}", "", f"源文件：`{ex}/request.body`、`{ex}/response.body`（内容未改动，仅重新排版）", "",
          f"折叠查看：[{ex}.json](../json/{ex}.json)（标准 JSON，可折叠）、[{ex}.json5](../json/{ex}.json5)（换行展示版，长值自动折行）", ""]
    try:
        rb = json.loads(req_b)
        md += ["## 顶层 key 速览", "", "| key | 值形态 |", "| --- | --- |"]
        md += [f"| `{k}` | {key_summary(k, rb.get(k))} |" for k in KEY_ORDER]
        md += ["", "（详细内容见下方缩进 JSON）", ""]
    except json.JSONDecodeError:
        pass  # request.body 非 JSON 时跳过速览表
    md += ["## request.body", "", "```json", format_request_body(req_b).rstrip(), "```", "",
           "## response.body", "", "（SSE 流，`data:` 中的 JSON 已按事件分节重排）", "", "```",
           format_response_body(resp_b).rstrip(), "```", ""]
    (MD / f"{ex}.md").write_text("\n".join(md), encoding="utf-8")
    index_lines.append(f"- [{ex}](md/{ex}.md) —{summary}")

    # 导出每 exchange 一个合并 .json 文件供编辑器折叠查看（内容与 body 完全一致）
    json_dir = OUT / "json"
    json_dir.mkdir(exist_ok=True)
    events = []
    for block in resp_b.split("\n\n"):
        if not block.strip():
            continue
        ev, data = None, None
        for line in block.splitlines():
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                d = line[5:].strip()
                try:
                    data = json.loads(d)
                except json.JSONDecodeError:
                    data = d  # 非 JSON 负载原样保留
        events.append({"event": ev, "data": data})
    try:
        rb = json.loads(req_b)
        merged = {"request": rb, "response": events}
        (json_dir / f"{ex}.json").write_text(
            json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (json_dir / f"{ex}.json5").write_text(
            dumps_json5(merged) + "\n", encoding="utf-8")  # 换行展示版（JSON5）
    except json.JSONDecodeError:
        pass  # request.body 非 JSON 时跳过导出
index_lines.append("")
index_lines.append("`json/` 目录：每 exchange 一个合并 .json 文件（含 request 与 response），供编辑器折叠查看；同名 `.json5` 为换行展示版（字符串内 `\\n` 展开为真实换行，需 JSON5 扩展）。")
(OUT / "index.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")
```
