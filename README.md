# Faithful Model-Exchange Recorder

一个零依赖、独立运行的 Node.js HTTP/1.1 反向代理，忠实记录 Claude Code（CLI 或 VS Code 扩展）与 DeepSeek 兼容上游之间的**完整模型流量**（Model Exchange）。

它只做两件事：把请求/响应**原样转发**到上游，并把每一次交换的**逐字节实体**和**完整 HTTP 元数据**落盘。JSON 和 SSE 从不被解析、规范化、重新生成、脱敏、解压或重压缩——录到的就是线上真实的字节。

## 为什么需要它

Claude Code 界面里看到的对话记录不够：它丢掉了请求元数据、system 内容、工具 schema、thinking 数据、流式事件、响应头，以及和模型交换的精确字节。本工具在模型 API 边界上以旁观者身份记录一切，且**不改变**任何请求/响应的含义与流式行为。

## 环境要求

- Linux
- Node.js >= 22（仅使用标准库，无任何第三方运行时依赖）
- [cc-switch](https://github.com/farion1231/cc-switch)（用于切换 Claude Code 的模型路由配置）

## 安装

```bash
npm link        # 将 `recorder` 命令链接到 PATH
```

不安装也可直接运行：

```bash
node src/index.mjs --upstream-base-url <URL> --output-root <目录>
```

## 启动脚本（推荐）

### 需要的环境

- Linux + Node.js >= 22
- 本仓库已克隆到本地。脚本直接调用仓库内的 `node src/index.mjs`，**无需** `npm install` 或 `npm link`
- [cc-switch](https://github.com/farion1231/cc-switch) 已配置好 **Recorder Profile**（见下文「配置 cc-switch」；切 profile 是 cc-switch 界面里的人工操作，脚本不会代做）

### 启动

```bash
npm run record
```

（等价于 `bash scripts/start-recording.sh`。）脚本依次完成：

1. **前置检查**：Node 版本 ≥ 22；读取 `~/.claude/settings.json` 检查当前 profile 是否已指向 Recorder——若还是直连地址会警告并询问是否继续（避免"录了半天没有流量"）；
2. 创建产物目录并启动 Recorder（输出 `Recorder listening on http://127.0.0.1:4318`）；
3. 使用结束后按 `Ctrl+C`（或 `SIGTERM`）停止，脚本会提醒产物位置并提示切回 Direct Profile。

### 默认值与覆盖

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `RECORDER_UPSTREAM_BASE_URL` | `https://api.deepseek.com/anthropic` | 上游网关 base URL |
| `RECORDER_OUTPUT_ROOT` | 项目根目录下 `.recordings` | 录制产物根目录 |
| `RECORDER_LISTEN` | `127.0.0.1:4318` | Recorder 监听地址（`host:port`） |

示例——录制到指定目录：

```bash
RECORDER_OUTPUT_ROOT=/data/recordings npm run record
```

## 使用

### 1. 启动 Recorder

```bash
recorder \
  --upstream-base-url https://api.deepseek.com/anthropic \
  --output-root .recordings
```

启动后输出 `Recorder listening on http://127.0.0.1:4318`。

**一键启动（推荐）**：见上方「启动脚本」小节，一条命令完成前置检查、启动与停止提醒。

### 2. 配置 cc-switch：复制 Direct Profile 生成 Recorder Profile

1. 在 cc-switch 中找到**当前正在使用的 DeepSeek profile**（直连模型的 Direct Profile），**复制**一份。不要从内置预设重建——预设与你实际生效的配置（模型映射等）并不完全一致。
2. 将副本重命名为易辨识的名字，如 `Recorder`。
3. **只修改副本的 Endpoint 字段**（对应 `env.ANTHROPIC_BASE_URL`），指向 Recorder 的监听地址：`http://127.0.0.1:4318`（若自定义了 `--listen`，填对应的 `http://host:port`）。
4. 其余一切**原样保留**：凭据字段与值（`ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`）、fallback 与 role-model 映射、子模型、`meta.apiFormat` 等。
5. 录制期间**关闭 cc-switch 的本地路由接管**，保证数据路径上只有 Harness、Recorder、Model 三者。

录制时在 cc-switch 选中 `Recorder`；停止录制后选中原 DeepSeek profile 即恢复直连。两个 profile 互相独立，Direct Profile 始终可单独选择。

### 3. 开始/结束录制

在 cc-switch 中切到 Recorder Profile，正常使用 Claude Code（CLI 或 VS Code 扩展均可），任意时刻按 `Ctrl+C`（SIGINT/SIGTERM）停止 Recorder：

- 停止后不再接纳新的交换；
- 已经接纳的交换会**全部排空完成**后才退出，不会截断最后一个交互；
- 所有已保存的交换全部保留。

停止 Recorder 不碰任何 cc-switch 配置，切回 Direct Profile 即可恢复直连。

## 命令行选项

| 选项 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--upstream-base-url` | 是 | — | 上游网关的绝对 HTTP(S) URL，支持路径前缀（如 DeepSeek 的 Anthropic 兼容网关）。必须是网关 base URL，**不能**是整个 `/v1/messages` 端点。 |
| `--output-root` | 是 | — | 录制产物的存放根目录。 |
| `--listen` | 否 | `127.0.0.1:4318` | 监听地址，形如 `host:port`。默认回环地址，普通录制无需暴露网络端口。 |

## 工作原理

- **会话锁定**：Recorder 启动后处于未锁定状态。第一条满足条件的 `POST /v1/messages` 请求——恰好携带一个非空的 `x-claude-code-session-id` 请求头（字段名大小写不敏感，值两侧空白忽略、其余视为不透明且区分大小写）——在请求头读完时锁定该 Harness Session，并完整记录这一次交换。此后该会话的所有 Model Exchange 都以**请求头接纳顺序**（而非网络到达顺序）记入同一会话目录，直到人为停止。
- **非模型流量**：缺少、为空或重复 session 字段的请求（warm-up、发现、token 计数等）会被转发但**不会**获得锁，也不会成为记录内容。
- **仅 HTTP/1.1**：其他版本一律以 505 拒绝。
- **凭据**：不单独配置——Harness 发来的认证头作为普通端到端请求字段原样转发。

## 录制产物格式

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

会话目录名是对 session ID 的可逆编码，可独立关联到对应的 Harness Session。若一次运行从未获取到会话，则**不产生任何会话目录**。

## 测试

```bash
npm test
```

使用 `node --test` 运行，**22 个测试全部通过**，覆盖：会话获取、流式实体逐字节转发、请求/响应封套保留、并发交换接纳顺序、HTTP/1.1 连接契约、正常停止排空等。字节级回放测试通过真实监听 socket 驱动完整 Recorder，与目标栈抓包 fixture 逐字节比对转发流与落盘产物。

**实况验收**（默认不跑：会连接真实模型并产生推理费用，且需先按 [docs/live-acceptance.md](docs/live-acceptance.md) 配置）：

```bash
export RECORDER_LIVE_ACCEPTANCE=1
export RECORDER_LIVE_UPSTREAM_BASE_URL=https://api.deepseek.com/anthropic
export RECORDER_LIVE_OUTPUT_ROOT=/absolute/path/to/live-recordings
export RECORDER_LIVE_CLI_PATH=/absolute/path/to/the/installed/claude
export RECORDER_LIVE_VSCODE_PATH=/absolute/path/to/the/extension-shipped/claude

npm run acceptance
```

## 开发状态

- ✅ **全部 20 张票已解决**：设计决策（issues 01–10）与实现（issues 11–20）全部完成并通过代码评审
- ✅ 自动化测试 22/22 通过，含目标栈 fixture 逐字节端到端回放（issue 19）
- ✅ 实况验收已自动化（issue 20）：无 VS Code UI 条件下驱动真实 Claude Code CLI 与 VS Code 扩展入口
- ✅ 2026-08-23 完成首次真实端到端录制：VS Code 扩展入口会话，10 个 Model Exchange 完整落盘

**已验证环境**（2026-08-21 实测；只认下表，不做任何版本承诺）：

| 组件 | 版本 |
| --- | --- |
| Claude Code CLI / VS Code 扩展入口 | 2.1.238 |
| VS Code | 1.116.0 |
| cc-switch | 3.15.0 |
| DeepSeek 端点 | `https://api.deepseek.com/anthropic`（`deepseek-v4-flash`） |

## 领域术语

项目使用的领域术语（Model Exchange、Harness Session、Recorder、Direct/Recorder Profile 等）见 [CONTEXT.md](CONTEXT.md)。完整规格见 `.scratch/faithful-recorder-design/spec.md`。
