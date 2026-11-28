import type { ProjectKnowledge } from "../context/types";
import { overviewChapterCards, type OverviewBasis, type ProjectOverviewWorkspace } from "../canvas/project-overview-workspace";
import type { FocusSession } from "../shared/focus-session";
import { sourceMessageSignature } from "../shared/source-signature";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { WikiClaim } from "../shared/wiki-claims";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit, WikiUnitAdoption, WikiUnitKind } from "../shared/wiki-knowledge";

export const architectureChapter = "transcription-arch";
export type DemoLocale = "zh" | "en";
type Localized = readonly [zh: string, en: string];

const engineTable: Localized = [
  "| 方案 | 2 小时播客耗时 | 隐私与离线 | 成本结构 | 最终结论 |\n| --- | --- | --- | --- | --- |\n| 云端 Whisper API | 约 1–2 分钟 | 需上传整段音频，隐私风险高 | 按分钟计费，高频用户成本失控 | 放弃，不作为主路径 |\n| 浏览器 WebGPU Whisper | 约 18–25 分钟 | 本地执行，受浏览器内存限制 | 免费，但长音频极易崩溃 | 仅作轻度网页试听参考 |\n| 本地 whisper.cpp（Metal / CUDA） | 约 3–5 分钟 | 音频永不离机，完全离线可用 | 零 API 费用，利用本机算力 | 确认为 V1 默认转写引擎 |",
  "| Option | 2-hour podcast time | Privacy & offline | Cost model | Decision |\n| --- | --- | --- | --- | --- |\n| Cloud Whisper API | ~1–2 min | Uploads full audio; high privacy risk | Per-minute billing; expensive at scale | Rejected as primary path |\n| Browser WebGPU Whisper | ~18–25 min | Local, constrained by tab memory | Free, prone to OOM on long audio | Reference only for short clips |\n| Local whisper.cpp (Metal / CUDA) | ~3–5 min | Audio never leaves device; works offline | Zero API fee; uses local GPU/NPU | Confirmed as V1 default engine |",
];

const citationRulesTable: Localized = [
  "| 异常场景 | 本地校验动作 | 界面呈现方式 | 用户恢复路径 |\n| --- | --- | --- | --- |\n| 摘要缺少 `[mm:ss]` 时间戳 | 标记为待核对，不自动伪造时间 | 显示「未绑定原声」浅黄提示 | 点击后定位到所属分段全文 |\n| 时间戳超出该段音频范围 | 拦截无效跳转并回退到段首 | 提示时间戳偏移并高亮该段 | 支持手动点击原文字幕重绑 |\n| 长音频某分片模型超时 | 仅重试失败分片，复用已完成分片 | 顶部进度条显示「已保留 N-1 段」 | 单个分片可一键重试或换模型 |\n| 全部校验通过 | 写入 SQLite 并更新 FTS5 索引 | 每条要点右侧附可点击原声时间戳 | 点击直接从对应秒数开始回放 |",
  "| Edge case | Local validation action | UI presentation | Recovery path |\n| --- | --- | --- | --- |\n| Summary item lacks `[mm:ss]` | Mark as unverified; never fabricate | Subtle amber 'Unlinked audio' badge | Opens the parent transcript chunk |\n| Timestamp exceeds chunk duration | Block bad seek; fall back to chunk start | Show offset notice and highlight chunk | User can rebind to exact subtitle line |\n| One chunk times out on LLM | Retry only failed chunk; reuse completed | Progress bar shows 'N-1 chunks kept' | One-click retry or switch provider |\n| Every check passes | Commit to SQLite and refresh FTS5 index | Clickable audio timestamp per bullet | Jumps directly to that exact second |",
];

const discussions: { id: string; platform: string; label: string; day: number; title: Localized; messages: readonly Localized[] }[] = [
  {
    id: "scope", platform: "chatgpt", label: "ChatGPT", day: 1,
    title: ["产品定位、目标人群与 V1 边界", "Product positioning, audience & V1 scope"],
    messages: [
      [
        "我平时每周会听 5–6 期两小时左右的技术播客，还有大量内部产品评审会。现在市面上的会议纪要工具几乎都要把整段录音上传到云端，而且总结出来的要点经常脱离原话、想回听原声根本找不到在哪一分钟。我想做一个叫「墨匣 LocalNote」的本地优先桌面工具，先解决我自己和独立开发者、播客重度听众的痛点。",
        "I listen to 5–6 two-hour tech podcasts every week plus internal design reviews. Almost every meeting-notes app uploads raw audio to the cloud, and their summaries drift away from what was actually said—you can't even jump back to the exact minute. I want to build LocalNote, a local-first desktop tool aimed at indie developers, researchers, and heavy podcast listeners.",
      ],
      [
        "这个切入点很清晰。建议 V1 可以做成「全能会议助手」：除了本地导入音频，还可以集成一个自动加入 Zoom / 腾讯会议的机器人（Meeting Bot），再配一个云端同步账号，这样手机端也能随时看纪要。",
        "That's a strong angle. For V1, we could position it as an all-in-one assistant: besides local audio import, add a Meeting Bot that automatically joins Zoom/Teams calls plus cloud account sync so users can read notes on mobile.",
      ],
      [
        "不要做自动入会机器人，也不要在 V1 建云端同步账号！一是入会机器人非常侵入式，很多团队反感；二是我们主打「音频与纪要完全留在本地」，一上来做云端存储就违背核心信任了。另外也不要内置收费语音转写套餐。",
        "No meeting bots and no cloud sync accounts in V1! First, meeting bots are intrusive and many teams ban them; second, our entire trust model is 'audio and notes stay on your machine'—shipping cloud storage on day one breaks that promise. Also don't bundle paid transcription credits.",
      ],
      [
        "明白，那 V1 范围收敛得非常干净：只做桌面端本地体验——支持拖拽导入 MP3/M4A/WAV 与系统内录，本地离线转写，用户自带大模型 API（BYOK）生成带时间戳的纪要，并支持本地全文搜索和导出 Markdown。",
        "Understood—that makes V1 super focused: a local-first desktop app with drag-and-drop MP3/M4A/WAV import and system audio capture, offline transcription, BYOK LLM summaries with timestamps, local full-text search, and Markdown export.",
      ],
      [
        "确认 V1 首版范围：仅做 macOS 与 Windows 桌面端，支持本地音频导入、系统内录、离线转写、BYOK 摘要与 Markdown 导出；明确不做自动入会机器人，不提供云端录音存储。",
        "Confirmed V1 scope: macOS and Windows desktop only, supporting local audio import, system loopback recording, offline transcription, BYOK summaries, and Markdown export; explicitly no meeting bots and no cloud audio storage.",
      ],
    ],
  },
  {
    id: "transcription", platform: "claude", label: "Claude", day: 3,
    title: ["离线转写架构：从云端 API 转向本地 whisper.cpp", "Offline transcription: moving from cloud API to local whisper.cpp"],
    messages: [
      [
        "最初的原型为了省事，我直接接了 OpenAI Whisper API，把 M4A 切片传上去跑。虽然速度挺快，但是一期 2 小时播客要切 6 片、每次都要等上传，而且公司内部评审会根本不敢传云端。我想评估下彻底改成本地转写的可行性。",
        "In the early prototype I called OpenAI's Whisper API directly by slicing M4A files and uploading them. It was fast, but a 2-hour podcast needed 6 uploads and I can't upload internal company meetings to the cloud. Let's evaluate moving transcription completely local.",
      ],
      [
        "把三种主流路线放在一起对比非常直观：\n\n" + engineTable[0] + "\n\n如果采用本地 whisper.cpp 配合 Silero VAD 先按静音切段，既能避免 Whisper 在长静音处出现幻觉复读，也能把 2 小时音频拆成几十个可并发/断点续传的短片段。",
        "Comparing the three main options makes the tradeoff clear:\n\n" + engineTable[1] + "\n\nPairing local whisper.cpp with Silero VAD silence segmentation both prevents Whisper hallucination loops during pauses and turns a 2-hour recording into resumable chunks.",
      ],
      [
        "这个对比很清楚。我确认放弃云端 Whisper API 主路径，正式采用本地 whisper.cpp（macOS 走 Metal，Windows 优先 CUDA 并保留 CPU 回退），转写前统一用 Silero VAD 切分语音段，避免长静音幻觉。",
        "That comparison settles it. I'm officially dropping the cloud Whisper API as our primary path and adopting local whisper.cpp (Metal on macOS, CUDA with CPU fallback on Windows), with Silero VAD segmentation beforehand to prevent silence hallucinations.",
      ],
      [
        "另外模型下载体验也很重要：whisper large-v3-turbo 量化后大约 800 MB。建议首次启动时不强制下载大模型，默认给一个 150 MB 的 base 模型快速试跑，设置页再按需一键下载 turbo / medium 模型并校验 SHA-256。",
        "Model onboarding matters too: quantized whisper large-v3-turbo is ~800 MB. I suggest not forcing a huge download on first launch—ship a fast 150 MB base model option first, and let users download turbo/medium on demand in Settings with SHA-256 verification.",
      ],
      [
        "同意！首次启动提供轻量级模型引导，大体积量化模型按需下载并校验 SHA-256；同时把音频原始文件和转写字幕分目录存放，用户删掉大音频文件后文字纪要和检索索引依然保留可用。",
        "Agreed! Offer a lightweight starter model on first launch, download larger quantized models on demand with SHA-256 verification, and store raw audio separately from transcripts so deleting large audio files still keeps notes and search intact.",
      ],
    ],
  },
  {
    id: "storage", platform: "deepseek", label: "DeepSeek", day: 6,
    title: ["本地存储、SQLite FTS5 检索与崩溃恢复", "Local storage, SQLite FTS5 search & crash recovery"],
    messages: [
      [
        "早期原型里我把每期音频的转写结果存成一个个独立 JSON 文件，再在 SQLite 里建一份列表元数据。结果用户改完标题、删掉某段字幕或者程序意外闪退后，JSON 和 SQLite 经常对不上，全局搜索也很慢。",
        "In the early prototype I saved each recording's transcript as a separate JSON file while keeping metadata rows in SQLite. Whenever someone renamed a title, edited a subtitle, or hit a crash, the JSON and SQLite went out of sync and global search felt sluggish.",
      ],
      [
        "把两份存储合并为单一事实源是最稳妥的做法：全部元数据、带毫秒时间戳的字幕分段、AI 摘要块以及用户手动批注统一写入单个 SQLite（开启 WAL 模式），并直接挂载 FTS5 虚表配合中文分词 tokenizer（或 trigram）做毫秒级全文检索。下面是一个精简表结构示意：\n\n```sql\nCREATE TABLE segments (\n  id TEXT PRIMARY KEY,\n  recording_id TEXT NOT NULL,\n  start_ms INTEGER NOT NULL,\n  end_ms INTEGER NOT NULL,\n  speaker TEXT,\n  text TEXT NOT NULL\n);\nCREATE VIRTUAL TABLE segments_fts USING fts5(text, content='segments', tokenize='trigram');\n```",
        "Consolidating into a single source of truth is much safer: store metadata, millisecond-stamped transcript segments, AI summary blocks, and user edits in one SQLite database (WAL mode) with an FTS5 virtual table for instant full-text search:\n\n```sql\nCREATE TABLE segments (\n  id TEXT PRIMARY KEY,\n  recording_id TEXT NOT NULL,\n  start_ms INTEGER NOT NULL,\n  end_ms INTEGER NOT NULL,\n  speaker TEXT,\n  text TEXT NOT NULL\n);\nCREATE VIRTUAL TABLE segments_fts USING fts5(text, content='segments', tokenize='trigram');\n```",
      ],
      [
        "拍板：放弃「独立 JSON + SQLite」双写方案，统一采用单 SQLite（WAL 模式）+ FTS5 作为唯一事实源。另外长录音在实时内录时，必须每 30 秒把音频帧和已转写分片落盘一次，确保电脑突然断电或闪退最多只丢 30 秒以内。",
        "Decided: drop the dual JSON + SQLite storage and standardize on a single SQLite (WAL mode) + FTS5 database as our sole source of truth. During live recording, flush audio frames and completed transcript chunks to disk every 30 seconds so a sudden crash or power loss never loses more than 30 seconds.",
      ],
      [
        "为了保护用户的手动修改，建议在 summary_blocks 表里区分 ai_text 和 user_edited_text 两个字段。以后用户换更强的模型重新生成摘要时，默认先以预览方式展示差异，绝不静默覆盖用户亲手改过的段落。",
        "To protect personal edits, separate ai_text and user_edited_text in summary_blocks. If a user regenerates a summary with a newer model, show a diff preview first and never silently overwrite paragraphs the user manually edited.",
      ],
      [
        "非常赞同，这点直接作为硬约束：AI 重新生成纪要只能生成新版本或预览对比，严禁静默覆盖用户的手动编辑和批注。",
        "Strongly agree—make that a hard constraint: regenerating summaries creates a preview or new version and must never silently overwrite user edits or annotations.",
      ],
    ],
  },
  {
    id: "routing", platform: "gemini", label: "Gemini", day: 9,
    title: ["多模型摘要路由、分段预算与原声时间戳校验", "Multi-model routing, chunk budgets & timestamp verification"],
    messages: [
      [
        "一期 2 小时的播客转写出来经常有 2.5 万到 3.5 万字，直接整篇塞给大模型不仅贵、容易遗漏中间细节，而且模型给出来的 `[42:15]` 时间戳经常是瞎编的。怎么设计一套靠谱的摘要和时间戳校验链路？",
        "A 2-hour podcast transcript often hits 25k–35k words. Stuffing it into one LLM call is pricey, drops middle details, and the `[42:15]` timestamps models output are often hallucinated. How should we design a reliable summarization and citation pipeline?",
      ],
      [
        "可以把生成拆成两段式 Map-Reduce 管线：先按 15 分钟 / 约 6,000 Token 切片并保留前后 60 秒重叠上下文，每片用便宜快的经济模型（如 DeepSeek / GPT-4o-mini / Gemini Flash）提取带精确 `segment_id` 的结构化要点，最后再用主模型汇总成章节纪要。这样既省 Token 又能复用已成功分片。",
        "Split generation into a two-stage map-reduce pipeline: slice into 15-minute (~6,000-token) chunks with 60-second overlap, use a fast economy model (DeepSeek / GPT-4o-mini / Gemini Flash) to extract structured points referencing exact `segment_id`s, then synthesize chapters with the primary model. It saves tokens and reuses completed chunks.",
      ],
      [
        "分段思路很好，但怎么彻底避免模型自己瞎编 `[mm:ss]` 时间戳？如果某个分片中途超时了，重跑会不会把前面已经花钱跑完的分片全部作废？",
        "Chunking makes sense, but how do we completely stop models from fabricating `[mm:ss]` timestamps? And if one chunk times out halfway, will a retry throw away all the chunks we already paid for?",
      ],
      [
        "关键在于时间戳绝不能让模型自己拼 `[mm:ss]`，而是让模型只引用我们传入的真实 `segment_id`，由本地程序回查 SQLite 还原精确毫秒时间！同时本地要做四类异常处理：\n\n" + citationRulesTable[0],
        "The key is never letting the model invent `[mm:ss]` strings—have it cite only real `segment_id`s from our input, then resolve exact millisecond timestamps locally from SQLite, with four explicit local guardrails:\n\n" + citationRulesTable[1],
      ],
      [
        "确认采用「模型引用 `segment_id` + 本地程序还原毫秒时间戳」机制，绝不信任模型手写时间；并采用 15 分钟切片 Map-Reduce，支持单分片失败重试与已成功分片复用。",
        "Confirmed: use 'model cites `segment_id` + local code resolves millisecond timestamps'—never trust LLM-typed times—and run 15-minute chunked map-reduce with per-chunk retry and reuse.",
      ],
      [
        "另外关于模型配置：用户可能只配一个模型，也可能配「主力模型 + 经济模型」。建议允许单模型开箱即用，经济模型作为高级可选，API Key 仅存操作系统钥匙串（macOS Keychain / Windows Credential Manager），绝不写明文配置文件。",
        "For model setup, users might configure one model or a primary + economy pair. Support single-model out of the box with economy model optional, and store API keys strictly in the OS keychain (macOS Keychain / Windows Credential Manager), never plaintext files.",
      ],
    ],
  },
  {
    id: "client", platform: "claude", label: "Claude", day: 12,
    title: ["客户端录屏浮窗与 Obsidian / Markdown 导出", "Floating recorder UI & Obsidian / Markdown export"],
    messages: [
      [
        "开会时我不想一直切回大窗口看录音状态。希望有一个全局快捷键唤出的极简录音浮窗，能看到麦克风+系统声双轨电平、一键打「重点标记（Bookmark）」，会后直接把重点标记优先排进纪要里。",
        "During meetings I don't want to keep alt-tabbing back to a full window. I want a minimal floating bar toggled by a global shortcut showing mic + system audio levels and a one-click Bookmark button so marked moments get prioritized in the summary.",
      ],
      [
        "这个交互很实用！浮窗保持 320px 宽的胶囊形态，只放「录音时长 / 双轨电平 / 打标 / 暂停结束」四个控件。打标时记录精确毫秒并允许 2 秒内补一句短备注，零打扰。",
        "That's super practical. Keep the floating bar a compact 320px pill with just four controls: timer, dual-channel meter, Bookmark, and Pause/Stop. Bookmarking captures the exact millisecond with an optional quick note without stealing focus.",
      ],
      [
        "另外导出格式是重中之重：很多用户用 Obsidian、Notion 或直接丢给 Claude Code。我确认导出支持三种预设——「精简纪要（无时间戳噪点）」、「完整笔记（含 YAML frontmatter、决策清单与可点击 `localnote://play` 回放链接）」以及「原始逐字稿（SRT / TXT）」，并支持一键写入指定 Obsidian Vault 文件夹。",
        "Export is also critical—many users use Obsidian, Notion, or paste into Claude Code. Confirmed three export presets: 'Clean Brief' (no timestamp noise), 'Full Note' (YAML frontmatter, action items, and clickable `localnote://play` audio links), and 'Raw Transcript' (SRT / TXT), plus one-click save into a chosen Obsidian Vault folder.",
      ],
      [
        "要不要在 V1 就加入自定义 Prompt 模板市场？或者先内置 4 套高质量模板（产品评审、技术播客、用户访谈、课程讲座）外加本地自定义模板？",
        "Should V1 include a community prompt template marketplace, or ship 4 built-in templates (Product Review, Tech Podcast, User Interview, Lecture) plus local custom templates?",
      ],
      [
        "先别做社区模板市场，V1 内置 4 套场景模板并允许本地自定义编辑就够了，把精力花在转写准度和回跳体验上。",
        "Skip the template marketplace for V1—4 built-in scenario templates plus local editing is plenty. Keep focus on transcription accuracy and audio-jump fidelity.",
      ],
    ],
  },
  {
    id: "pricing", platform: "chatgpt", label: "ChatGPT", day: 15,
    title: ["开源边界与商业化定价策略讨论", "Open-source boundary & monetization discussion"],
    messages: [
      [
        "我在纠结墨匣 LocalNote 的开源和收费边界。核心本地录音、离线转写、BYOK 摘要和 Markdown 导出我觉得应该完全免费开源（MIT），这样大家才敢放心把内部会议录音交给它。",
        "I'm weighing the open-source and pricing boundary for LocalNote. Core local recording, offline transcription, BYOK summaries, and Markdown export should be free and MIT open-source so users truly trust it with private meetings.",
      ],
      [
        "完全赞成核心 MIT 开源建立信任！商业化可以考虑在 V2 提供两类可选增值：一是「个人买断 Pro 版」（含跨设备端到端加密同步、批量播客 RSS 自动追更、自定义多说话人声纹库）；二是「团队共享知识空间订阅」。",
        "Open-sourcing the core under MIT is a great trust builder. For V2 monetization, two optional tiers make sense: a one-time personal Pro license (E2EE multi-device sync, podcast RSS auto-fetch, custom speaker voiceprints) or a Team workspace subscription.",
      ],
      [
        "确认开源边界：桌面端核心能力（本地录音、whisper.cpp 离线转写、SQLite 检索、BYOK 摘要与 Markdown/Obsidian 导出）永久免费且 MIT 开源。至于 V2 的端到端加密同步到底是按年订阅还是买断制，以及播客 RSS 自动追更要不要放进 Pro，现在先记为待决问题，等 V1 跑通用户留存再定。",
        "Confirmed open-source boundary: core desktop features (local capture, whisper.cpp offline transcription, SQLite search, BYOK summaries, and Markdown/Obsidian export) stay free and MIT open-source forever. Whether V2 E2EE sync uses a one-time license or annual subscription—and whether RSS auto-fetch goes into Pro—stays open until we validate V1 retention.",
      ],
    ],
  },
  {
    id: "benchmarks", platform: "deepseek", label: "DeepSeek", day: 18,
    title: ["M1 内测压测数据与遗留问题清单", "M1 internal benchmark results & open issues"],
    messages: [
      [
        "这两天我用 M1 原型跑完了真实长音频压测，记录一下实测数据（别把还没做的写成已完成）：在 M2 MacBook Air（16 GB）上用 Metal 跑 whisper large-v3-turbo，2 小时中文技术播客转写耗时 3 分 42 秒，峰值内存 1.85 GB；在 Windows RTX 4060 8 GB 上耗时 1 分 58 秒。30 秒定时落盘在强杀进程测试中成功恢复了 99% 内容。",
        "I just finished real long-audio benchmarks on the M1 prototype—recording exact numbers here (don't mark unfinished items done): on an M2 MacBook Air (16 GB) using Metal with whisper large-v3-turbo, a 2-hour podcast transcribed in 3m42s with 1.85 GB peak RAM; on Windows RTX 4060 8 GB it took 1m58s. The 30s disk flush recovered 99% of content after a forced kill test.",
      ],
      [
        "这组端侧性能数据非常漂亮！不过有两个痛点你前面提到还没彻底收口：1）多说话人分离（Speaker Diarization）在两人抢话重叠时准确率偏低；2）macOS 15 升级后 ScreenCaptureKit 的系统录音权限每月弹窗，需要做清晰的引导页。",
        "Those on-device numbers look great! Two rough edges still need closure though: 1) Speaker diarization accuracy drops during overlapping speech; 2) macOS 15 ScreenCaptureKit system-audio permission re-prompts monthly and needs a clear onboarding guide.",
      ],
      [
        "对，多说话人分离目前我还没定技术方案：Pyannote 效果最好但打包要带 Python 运行时太重（增加 1.2 GB 安装包）；sherpa-onnx 轻量只有 40 MB 但中文抢话场景误判率稍高。这个问题先留作待决，M2 专门做一轮对比评测再拍板。",
        "Right—speaker diarization isn't settled yet: Pyannote has the best accuracy but bundles a heavy Python runtime (+1.2 GB installer); sherpa-onnx is only ~40 MB but struggles slightly on overlapping speech. Keep this as an open question and run a dedicated M2 evaluation before deciding.",
      ],
      [
        "另外还有个问题：老款无独显的轻薄本（纯 CPU 跑 large-v3-turbo）2 小时音频需要接近 28 分钟，风扇噪音大。建议 M2 增加「硬件档位自动检测」，无独显且内存 ≤ 8 GB 时自动推荐 small-q5 模型，同时允许用户手动切回大模型。",
        "One more thing: on older CPU-only laptops, large-v3-turbo takes ~28 minutes for 2 hours with loud fans. I suggest adding automatic hardware tier detection in M2 to recommend small-q5 on CPU-only ≤ 8 GB machines while letting users override.",
      ],
      [
        "收到！硬件档位自动推荐记为 AI 建议，等 M2 和说话人分离一起评估；另外 iOS 手机端同步录音的方式（局域网扫码传输 vs iCloud Drive 文件夹监听）也先记为待决问题，不阻塞 V1 桌面端发布。",
        "Got it! Record hardware-tier auto-recommendation as an AI proposal to evaluate in M2 alongside diarization. Also keep iOS companion audio transfer (LAN QR transfer vs iCloud Drive folder watch) as an open question—do not block V1 desktop launch.",
      ],
    ],
  },
];

export function demoProject(locale: DemoLocale) {
  const translate = (pair: Localized) => pair[locale === "zh" ? 0 : 1];
  const timestamp = (day: number) => Date.UTC(2026, 10, day);
  const platforms = new Map(discussions.map(chat => [chat.id, chat.label]));
  const conversations: Conversation[] = discussions.map(chat => ({
    id: chat.id,
    title: translate(chat.title),
    platform: chat.platform,
    url: "",
    messageCount: chat.messages.length,
    updatedAt: timestamp(chat.day),
    hydrationState: "hydrated",
    importState: "complete",
  }));
  const messages: ConversationMessage[] = discussions.flatMap(chat => chat.messages.map((pair, index) => {
    const content = translate(pair);
    const time = timestamp(chat.day) + index * 90_000;
    return {
      id: chat.id + "-" + index,
      conversationId: chat.id,
      role: index % 2 ? "assistant" : "user",
      content,
      preview: content,
      messageIndex: index,
      contentHash: sourceMessageSignature(content),
      createdAt: time,
      updatedAt: time,
    };
  }));
  const evidence = messages.map(message => ({
    id: "source-" + message.id,
    conversationId: message.conversationId,
    messageId: message.id,
    excerpt: message.content,
    sourceSignature: message.contentHash,
    title: platforms.get(message.conversationId) + " · " + conversations.find(chat => chat.id === message.conversationId)!.title,
  }));
  const byMessage = new Map(evidence.map(ref => [ref.messageId, ref]));
  const messageById = new Map(messages.map(message => [message.id, message]));

  const section = (
    id: string,
    title: Localized,
    group: Localized,
    body: Localized,
    bindings: readonly (readonly [string, Localized, WikiClaim["holder"], WikiClaim["workStatus"]?])[],
  ) => ({
    id,
    title: translate(title),
    wikiDisplayTitle: translate(title),
    wikiGroup: translate(group),
    kind: "finding" as const,
    transition: "",
    body: translate(body),
    evidenceIds: [...new Set(bindings.map(([message]) => byMessage.get(message)!.id))],
    claims: bindings.map(([message, statement, holder, workStatus]) => {
      const ref = byMessage.get(message)!;
      const firstBlock = ref.excerpt.split("\n\n", 1)[0];
      return {
        text: translate(statement),
        quote: firstBlock,
        evidenceIds: [ref.id],
        verification: "supported" as const,
        holder,
        holderMark: true,
        workStatus,
        userDecided: holder === "decided",
      };
    }),
  });

  const sections = [
    section(
      "product-scope",
      ["产品定位与 V1 边界", "Product positioning & V1 scope"],
      ["产品策略", "Product strategy"],
      [
        [
          "墨匣 LocalNote 面向独立开发者、产品经理与重度播客听众，解决「长音频纪要被迫上传云端」与「AI 总结脱离原声、无法回听核对」两大痛点。",
          "## V1 核心交付范围",
          "V1 仅交付 macOS 与 Windows 桌面端，打通「本地音频导入（MP3/M4A/WAV）与系统内录 → 离线转写 → BYOK 大模型摘要 → 本地全文检索与 Markdown 导出」完整闭环。",
          "## 明确不做的红线",
          "为了守住「音频与纪要永不离机」的信任底座，V1 明确不做自动加入 Zoom / 腾讯会议的入侵式机器人，不建立云端录音存储账号，也不内置收费转写积分包。",
        ].join("\n\n"),
        [
          "LocalNote is built for indie developers, PMs, and heavy podcast listeners tired of uploading private audio to cloud note-takers and getting summaries disconnected from the original recording.",
          "## V1 core scope",
          "V1 ships macOS and Windows desktop apps covering the full local loop: audio file import (MP3/M4A/WAV) + system loopback capture → offline transcription → BYOK LLM summarization → local full-text search and Markdown export.",
          "## Explicit V1 exclusions",
          "To keep the local-first trust promise intact, V1 explicitly excludes intrusive Zoom/Teams meeting bots, cloud audio storage accounts, and bundled paid transcription credits.",
        ].join("\n\n"),
      ],
      [
        ["scope-4", ["V1 仅交付 macOS 与 Windows 桌面端", "V1 ships macOS and Windows desktop apps"], "decided"],
        ["scope-2", ["V1 明确不做自动加入 Zoom / 腾讯会议的入侵式机器人，不建立云端录音存储账号", "V1 explicitly excludes intrusive Zoom/Teams meeting bots, cloud audio storage accounts"], "decided"],
      ],
    ),
    section(
      architectureChapter,
      ["离线转写与隐私架构", "Offline transcription & privacy architecture"],
      ["核心架构", "Core architecture"],
      [
        [
          "早期原型为了快速验证接入了云端 Whisper API，但在 2 小时播客场景下需要反复切片上传，且无法满足内部会议的隐私底线。",
          "## 转写引擎选型对比",
          "**离线转写方案评估**",
          engineTable[0],
          "## 最终落地方案",
          "正式放弃云端 Whisper API 主路径，采用本地 whisper.cpp（macOS 走 Metal 加速，Windows 优先 CUDA 并保留 CPU 回退）。转写前统一通过 Silero VAD 按静音切分语音段，避免模型在长静音片段产生幻觉复读。",
          "## 端侧模型引导与存储解耦",
          "首次启动提供约 150 MB 的轻量 base 模型快速体验，large-v3-turbo（约 800 MB）等高精度量化模型在设置页按需下载并校验 SHA-256。原始大体积音频与转写文本分目录存储，删除原始录音后纪要和检索索引仍保持完整可用。",
        ].join("\n\n"),
        [
          "The early prototype called the cloud Whisper API for speed, but slicing and uploading 2-hour podcasts was clunky and unacceptable for confidential internal meetings.",
          "## Engine tradeoff comparison",
          "**Offline transcription evaluation**",
          engineTable[1],
          "## Confirmed architecture",
          "Drop the cloud Whisper API as our primary path and adopt local whisper.cpp (Metal on macOS, CUDA with CPU fallback on Windows). Run Silero VAD silence segmentation beforehand to prevent hallucination loops during pauses.",
          "## Model onboarding & decoupled audio storage",
          "Offer a ~150 MB lightweight base model on first launch and download larger quantized models like large-v3-turbo (~800 MB) on demand with SHA-256 verification. Store raw audio separately from transcripts so deleting large audio files keeps notes and search intact.",
        ].join("\n\n"),
      ],
      [
        ["transcription-2", ["正式放弃云端 Whisper API 主路径，采用本地 whisper.cpp（macOS 走 Metal 加速，Windows 优先 CUDA 并保留 CPU 回退）", "Drop the cloud Whisper API as our primary path and adopt local whisper.cpp (Metal on macOS, CUDA with CPU fallback on Windows)"], "decided"],
        ["transcription-4", ["首次启动提供约 150 MB 的轻量 base 模型快速体验", "Offer a ~150 MB lightweight base model on first launch"], "decided"],
      ],
    ),
    section(
      "storage-indexing",
      ["本地存储、检索与崩溃恢复", "Local storage, search & crash recovery"],
      ["核心架构", "Core architecture"],
      [
        [
          "早期原型将转写正文存为独立 JSON 文件、列表元数据存进 SQLite，重命名或闪退后经常出现双端不一致且搜索卡顿。",
          "## 单一事实源：SQLite WAL + FTS5",
          "全面放弃「独立 JSON + SQLite」双写，统一将录音元数据、毫秒级字幕分段、AI 摘要块与用户批注存入单个 SQLite（WAL 模式），通过 FTS5 `trigram` 虚表提供毫秒级中英文全文检索。",
          "```sql\nCREATE TABLE segments (\n  id TEXT PRIMARY KEY,\n  recording_id TEXT NOT NULL,\n  start_ms INTEGER NOT NULL,\n  end_ms INTEGER NOT NULL,\n  speaker TEXT,\n  text TEXT NOT NULL\n);\nCREATE VIRTUAL TABLE segments_fts USING fts5(text, content='segments', tokenize='trigram');\n```",
          "## 30 秒断点落盘与手稿保护",
          "实时内录期间每 30 秒将音频帧与已完成的转写分片强制落盘一次，确保断电或闪退最多只丢失 30 秒以内内容。AI 摘要与用户手写编辑拆字段隔离存储，重新生成纪要只展示预览对比，严禁静默覆盖用户的手动修改。",
        ].join("\n\n"),
        [
          "The early prototype split transcripts into loose JSON files while keeping list metadata in SQLite, leading to desync after renames or crashes and sluggish search.",
          "## Single source of truth: SQLite WAL + FTS5",
          "Drop dual JSON + SQLite storage and keep recording metadata, millisecond segments, AI summaries, and user notes in one SQLite WAL database backed by an FTS5 `trigram` index for instant bilingual search.",
          "```sql\nCREATE TABLE segments (\n  id TEXT PRIMARY KEY,\n  recording_id TEXT NOT NULL,\n  start_ms INTEGER NOT NULL,\n  end_ms INTEGER NOT NULL,\n  speaker TEXT,\n  text TEXT NOT NULL\n);\nCREATE VIRTUAL TABLE segments_fts USING fts5(text, content='segments', tokenize='trigram');\n```",
          "## 30-second crash checkpoints & edit protection",
          "During live capture, flush audio frames and completed transcript chunks to disk every 30 seconds so sudden crashes never lose more than 30 seconds. Keep AI prose and user edits separate so regenerating summaries always shows a diff preview and never silently overwrites manual edits.",
        ].join("\n\n"),
      ],
      [
        ["storage-2", ["全面放弃「独立 JSON + SQLite」双写，统一将录音元数据、毫秒级字幕分段、AI 摘要块与用户批注存入单个 SQLite（WAL 模式）", "Drop dual JSON + SQLite storage and keep recording metadata, millisecond segments, AI summaries, and user notes in one SQLite WAL database"], "decided"],
        ["storage-4", ["重新生成纪要只展示预览对比，严禁静默覆盖用户的手动修改", "regenerating summaries always shows a diff preview and never silently overwrites manual edits"], "decided"],
      ],
    ),
    section(
      "summary-routing",
      ["多模型路由与原声时间戳回跳", "Multi-model routing & audio citations"],
      ["AI 管线", "AI pipeline"],
      [
        [
          "2 小时播客转写稿常超过 3 万字，单次调用不仅容易漏掉中段信息，模型直接输出的 `[mm:ss]` 时间戳也经常出现幻觉偏移。",
          "## 15 分钟分段 Map-Reduce 与缓存复用",
          "采用两段式管线：按 15 分钟（约 6,000 Token）切片并保留前后 60 秒上下文重叠，先由经济模型提取结构化要点，再由主模型汇总为章节纪要；单个分片失败时只重试该片并复用其余成功分片。API Key 仅保存在操作系统钥匙串中，绝不明文落盘。",
          "## 程序还原时间戳与本地校验规则",
          "严禁由模型手写时间字符串：模型仅返回输入上下文里的真实 `segment_id`，由本地程序回查 SQLite 还原精确毫秒位置并执行四类校验：",
          "**时间戳绑定与容错规则**",
          citationRulesTable[0],
        ].join("\n\n"),
        [
          "A 2-hour podcast transcript easily tops 30k words; one-shot calls drop middle details and LLM-typed `[mm:ss]` timestamps frequently hallucinate.",
          "## 15-minute chunked map-reduce & reuse",
          "Slice into 15-minute (~6,000-token) chunks with 60-second overlap, extract structured points with an economy model, and synthesize chapters with the primary model—retrying only failed chunks while reusing completed ones. API keys stay strictly in the OS keychain.",
          "## Deterministic timestamp resolution & guardrails",
          "Never let models type raw timestamps: models cite real `segment_id`s from input, and local code resolves exact millisecond offsets from SQLite with four guardrails:",
          "**Timestamp binding & fallback rules**",
          citationRulesTable[1],
        ].join("\n\n"),
      ],
      [
        ["routing-4", ["模型仅返回输入上下文里的真实 `segment_id`，由本地程序回查 SQLite 还原精确毫秒位置", "models cite real `segment_id`s from input, and local code resolves exact millisecond offsets from SQLite"], "decided"],
        ["routing-5", ["API Key 仅保存在操作系统钥匙串中，绝不明文落盘", "API keys stay strictly in the OS keychain"], "ai"],
      ],
    ),
    section(
      "client-workflow",
      ["客户端交互与 Obsidian 导出", "Client workflow & Obsidian export"],
      ["交互与导出", "UX & export"],
      [
        [
          "## 极简全局录音浮窗与一键打标",
          "会议期间通过全局快捷键唤出 320px 宽的胶囊录音浮窗，仅展示录音时长、麦克风与系统声双轨电平、一键「重点打标」与暂停/结束四个控件。点击打标记录精确毫秒，并可在总结阶段优先提炼标记片段。",
          "## 三模式导出与 Obsidian Vault 直写",
          "导出提供三种开箱即用预设：精简纪要（去除时间戳噪点，适合快速阅读或续聊）、完整笔记（含 YAML frontmatter、决策清单与可点击 `localnote://play` 原声回跳链接）以及原始逐字稿（SRT / TXT），支持一键写入指定 Obsidian Vault 文件夹。",
          "## 场景模板收敛策略",
          "V1 暂不建设社区模板市场，先内置产品评审、技术播客、用户访谈、课程讲座 4 套场景模板并支持用户本地自定义编辑。",
        ].join("\n\n"),
        [
          "## Minimal floating recorder & one-click bookmarks",
          "Toggle a 320px pill bar via global shortcut showing timer, dual mic/system meters, one-click Bookmark, and Pause/Stop. Bookmarks capture exact milliseconds and prioritize those moments during summarization.",
          "## Three export presets & direct Obsidian Vault write",
          "Export supports three presets: Clean Brief (no timestamp noise), Full Note (YAML frontmatter, action items, and clickable `localnote://play` links), and Raw Transcript (SRT / TXT), plus one-click export into a chosen Obsidian Vault folder.",
          "## Focused template strategy",
          "Skip a community marketplace in V1; ship 4 built-in scenario templates (Product Review, Tech Podcast, User Interview, Lecture) plus local customization.",
        ].join("\n\n"),
      ],
      [
        ["client-2", ["导出提供三种开箱即用预设：精简纪要（去除时间戳噪点，适合快速阅读或续聊）、完整笔记（含 YAML frontmatter、决策清单与可点击 `localnote://play` 原声回跳链接）以及原始逐字稿（SRT / TXT）", "Export supports three presets: Clean Brief (no timestamp noise), Full Note (YAML frontmatter, action items, and clickable `localnote://play` links), and Raw Transcript (SRT / TXT)"], "decided"],
        ["client-4", ["V1 暂不建设社区模板市场，先内置产品评审、技术播客、用户访谈、课程讲座 4 套场景模板", "Skip a community marketplace in V1; ship 4 built-in scenario templates (Product Review, Tech Podcast, User Interview, Lecture)"], "decided"],
      ],
    ),
    section(
      "pricing-verification",
      ["开源边界、M1 压测与待决事项", "Open-source boundary, benchmarks & open work"],
      ["发布与验证", "Release & verification"],
      [
        [
          "## 开源与商业化边界",
          "核心桌面端能力（本地录音、whisper.cpp 离线转写、SQLite 全文检索、BYOK 摘要与 Markdown/Obsidian 导出）永久免费且 MIT 开源，建立隐私信任。V2 的端到端加密同步与播客 RSS 自动追更定价模式（买断 vs 订阅）留待 V1 留存验证后再定。",
          "## M1 真实压测进展（用户实测报告）",
          "在 M2 MacBook Air（16 GB）上通过 Metal 运行 whisper large-v3-turbo，2 小时中文技术播客转写耗时 3 分 42 秒，峰值内存 1.85 GB；Windows RTX 4060 8 GB 上耗时 1 分 58 秒。30 秒定时落盘在强杀进程测试中成功恢复了 99% 内容。",
          "## M2 待决与风险清单",
          "多说话人分离方案尚未最终拍板（Pyannote 准确度高但安装包暴涨 1.2 GB；sherpa-onnx 仅 40 MB 但中文抢话重叠场景误判率偏高）。此外，无独显老电脑的硬件档位自动推荐以及 iOS 手机端同步录音方式仍待 M2 评估。",
        ].join("\n\n"),
        [
          "## Open-source & pricing boundary",
          "Core desktop capabilities (local capture, whisper.cpp offline transcription, SQLite search, BYOK summaries, and Markdown/Obsidian export) stay free and MIT open-source forever. Pricing for V2 E2EE sync and RSS auto-fetch (one-time vs subscription) stays open until V1 retention is proven.",
          "## M1 benchmark results (user-reported)",
          "On an M2 MacBook Air (16 GB) using Metal with whisper large-v3-turbo, a 2-hour podcast transcribed in 3m42s with 1.85 GB peak RAM; on Windows RTX 4060 8 GB it took 1m58s. The 30s disk flush recovered 99% of content after a forced kill test.",
          "## Open questions for M2",
          "Speaker diarization is still undecided (Pyannote is accurate but adds 1.2 GB; sherpa-onnx is ~40 MB but weaker on overlapping speech). Hardware-tier auto-recommendation for CPU-only laptops and iOS companion audio transfer remain open for M2.",
        ].join("\n\n"),
      ],
      [
        ["pricing-2", ["核心桌面端能力（本地录音、whisper.cpp 离线转写、SQLite 全文检索、BYOK 摘要与 Markdown/Obsidian 导出）永久免费且 MIT 开源", "Core desktop capabilities (local capture, whisper.cpp offline transcription, SQLite search, BYOK summaries, and Markdown/Obsidian export) stay free and MIT open-source forever"], "decided"],
        ["benchmarks-0", ["在 M2 MacBook Air（16 GB）上通过 Metal 运行 whisper large-v3-turbo，2 小时中文技术播客转写耗时 3 分 42 秒，峰值内存 1.85 GB", "On an M2 MacBook Air (16 GB) using Metal with whisper large-v3-turbo, a 2-hour podcast transcribed in 3m42s with 1.85 GB peak RAM"], "user", "reported"],
        ["benchmarks-2", ["多说话人分离方案尚未最终拍板（Pyannote 准确度高但安装包暴涨 1.2 GB；sherpa-onnx 仅 40 MB 但中文抢话重叠场景误判率偏高）", "Speaker diarization is still undecided (Pyannote is accurate but adds 1.2 GB; sherpa-onnx is ~40 MB but weaker on overlapping speech)"], "open"],
      ],
    ),
  ];

  const unit = (
    id: string,
    messageId: string,
    subject: Localized,
    statement: Localized,
    kind: WikiUnitKind,
    adoption: WikiUnitAdoption,
    delivery: WikiKnowledgeUnit["delivery"] = "planned",
  ): WikiKnowledgeUnit => {
    const message = messageById.get(messageId)!;
    const ref = byMessage.get(messageId)!;
    return {
      id,
      subject: translate(subject),
      statement: translate(statement),
      kind,
      details: [],
      adoption: { status: adoption },
      delivery,
      evidence: {
        evidenceId: ref.id,
        conversationId: message.conversationId,
        messageId: message.id,
        messageIndex: message.messageIndex,
        role: message.role,
        pasted: false,
        quote: ref.excerpt.split("\n\n", 1)[0],
        sourceSignature: message.contentHash,
        discussedAt: message.createdAt,
      },
    };
  };

  const ledgerUnits: WikiKnowledgeUnit[] = [
    unit("u-scope-v1", "scope-4", ["首版范围", "V1 release scope"],
      ["V1 仅交付 macOS 与 Windows 桌面端，包含音频导入、系统内录、离线转写、BYOK 摘要与 Markdown 导出。", "V1 ships macOS & Windows desktop only: audio import, system loopback, offline transcription, BYOK summaries, and Markdown export."],
      "decision", "user_decision"),
    unit("u-scope-no-bot", "scope-2", ["首版排除红线", "V1 explicit exclusions"],
      ["V1 明确不做自动入会机器人，不提供云端录音存储账号，不捆绑收费转写积分。", "Explicitly no meeting bots, no cloud audio storage accounts, and no bundled transcription credits in V1."],
      "constraint", "user_decision"),
    unit("u-scope-bot-proposal", "scope-1", ["自动入会机器人", "Meeting bot proposal"],
      ["AI 曾建议在 V1 集成自动加入 Zoom/腾讯会议的机器人与云端账号同步（已被否决）。", "AI initially proposed a Zoom/Teams meeting bot and cloud sync account for V1 (rejected)."],
      "history", "rejected"),
    unit("u-trans-cloud-legacy", "transcription-0", ["离线转写选型", "Transcription engine"],
      ["早期原型使用 OpenAI 云端 Whisper API 切片上传，存在内部会议隐私风险与上传成本问题。", "Early prototype uploaded audio slices to the cloud Whisper API, creating privacy and cost issues."],
      "history", "unknown"),
    unit("u-trans-whispercpp", "transcription-2", ["离线转写选型", "Transcription engine"],
      ["正式采用本地 whisper.cpp（Metal / CUDA + CPU 回退），转写前统一用 Silero VAD 切分静音段。", "Adopt local whisper.cpp (Metal / CUDA + CPU fallback) with Silero VAD segmentation beforehand."],
      "decision", "user_decision"),
    unit("u-trans-model-onboarding", "transcription-4", ["模型下载与解耦", "Model onboarding & storage"],
      ["首次启动提供 150 MB 轻量模型引导，高精度量化模型按需下载并校验 SHA-256；音频与字幕分目录存储。", "Ship a 150 MB starter model first, download larger quantized models on demand with SHA-256 check, and decouple audio from transcripts."],
      "decision", "user_adopted"),
    unit("u-store-dual-legacy", "storage-0", ["本地存储模型", "Local storage model"],
      ["早期原型采用「独立 JSON + SQLite」双写存储，重命名或闪退后容易出现数据不同步。", "Early prototype wrote loose JSON files alongside SQLite metadata, causing desync after crashes."],
      "history", "unknown"),
    unit("u-store-sqlite", "storage-2", ["本地存储模型", "Local storage model"],
      ["统一使用单 SQLite（WAL 模式）+ FTS5 作为唯一事实源；实时内录每 30 秒落盘一次防止断电丢数据。", "Standardize on single SQLite (WAL) + FTS5 as sole source of truth, flushing live capture every 30s."],
      "decision", "user_decision"),
    unit("u-store-protect-edits", "storage-4", ["手稿保护约束", "Edit protection constraint"],
      ["AI 摘要与用户手稿分字段存储，重新生成纪要只展示预览对比，严禁静默覆盖用户编辑。", "Store AI prose and manual edits separately; regenerating always previews diffs and never silently overwrites user edits."],
      "constraint", "user_decision"),
    unit("u-route-mapreduce", "routing-4", ["分段与时间戳绑定", "Chunking & citation binding"],
      ["按 15 分钟切片执行 Map-Reduce 摘要并支持单分片复用；模型仅引用真实 segment_id，由本地程序还原毫秒时间戳。", "Run 15-minute chunked map-reduce with per-chunk reuse; models cite real segment_ids and local code resolves millisecond timestamps."],
      "decision", "user_decision"),
    unit("u-route-keychain", "routing-5", ["密钥安全存储", "API key security"],
      ["建议单模型开箱即用、经济模型高级可选，API Key 仅存入操作系统钥匙串（Keychain / Credential Manager）。", "Support single-model setup with optional economy model, storing API keys strictly in OS keychain."],
      "plan", "proposal"),
    unit("u-client-float", "client-1", ["极简录音浮窗", "Floating recorder bar"],
      ["建议全局快捷键唤出 320px 胶囊浮窗，仅放时长、双轨电平、重点打标与暂停结束四个控件。", "Suggest a 320px pill recorder bar via global shortcut with timer, dual meters, Bookmark, and Pause/Stop."],
      "plan", "proposal"),
    unit("u-client-export", "client-2", ["导出预设与 Obsidian", "Export presets & Obsidian"],
      ["导出提供精简纪要、完整笔记（含 YAML frontmatter 与 localnote://play 原声链接）和原始逐字稿三预设，支持直写 Obsidian Vault。", "Provide Clean Brief, Full Note (YAML frontmatter + localnote://play links), and Raw Transcript presets with direct Obsidian Vault write."],
      "decision", "user_decision"),
    unit("u-client-templates", "client-4", ["场景模板范围", "Scenario templates"],
      ["V1 不做社区模板市场，内置产品评审、技术播客、用户访谈、课程讲座 4 套模板并支持本地编辑。", "Skip template marketplace in V1; include 4 built-in scenario templates plus local editing."],
      "decision", "user_decision"),
    unit("u-price-oss", "pricing-2", ["开源边界", "Open-source boundary"],
      ["核心桌面端能力永久免费且 MIT 开源，建立本地隐私信任。", "Keep all core desktop capabilities free and MIT open-source forever."],
      "decision", "user_decision"),
    unit("u-price-v2-open", "pricing-2", ["V2 商业化模式", "V2 monetization model"],
      ["V2 端到端加密同步与播客 RSS 自动追更采用买断制还是订阅制，待 V1 验证留存后再定。", "Whether V2 E2EE sync and RSS auto-fetch use a one-time license or subscription stays open until V1 retention."],
      "question", "unknown"),
    unit("u-bench-m1", "benchmarks-0", ["M1 实测性能", "M1 benchmark report"],
      ["实测 M2 MacBook Air（16 GB）Metal 转写 2 小时播客耗时 3m42s（峰值内存 1.85 GB），RTX 4060 耗时 1m58s，30 秒落盘强杀恢复率 99%。", "Measured 2-hour transcription in 3m42s (1.85 GB peak RAM) on M2 Air Metal, 1m58s on RTX 4060, and 99% crash recovery from 30s checkpoints."],
      "report", "user_decision", "user_reported"),
    unit("u-bench-macos15", "benchmarks-1", ["macOS 权限引导", "macOS permission UX"],
      ["macOS 15 ScreenCaptureKit 系统录音权限每月重弹，建议补充清晰的引导页与状态提示。", "macOS 15 ScreenCaptureKit re-prompts monthly; add a guided onboarding screen and permission indicator."],
      "plan", "proposal"),
    unit("u-bench-diarization-open", "benchmarks-2", ["多说话人分离选型", "Speaker diarization choice"],
      ["多说话人分离尚未定案：Pyannote 准确但安装包增加 1.2 GB，sherpa-onnx 仅 40 MB 但中文抢话重叠场景误判率偏高。", "Speaker diarization undecided: Pyannote adds 1.2 GB; sherpa-onnx is ~40 MB but weaker on overlapping speech."],
      "question", "unknown"),
    unit("u-bench-hw-tier", "benchmarks-3", ["硬件档位自适应", "Hardware-tier auto-tuning"],
      ["建议 M2 增加硬件档位自动检测，无独显且内存 ≤ 8 GB 设备自动推荐 small-q5 量化模型。", "Suggest M2 hardware-tier detection recommending small-q5 on CPU-only ≤ 8 GB machines."],
      "plan", "proposal"),
    unit("u-bench-ios-open", "benchmarks-4", ["iOS 伴侣同步方式", "iOS companion transfer"],
      ["iOS 手机端同步录音到桌面端采用局域网扫码传输还是 iCloud Drive 文件夹监听，留待 M2 决定。", "iOS audio transfer to desktop (LAN QR transfer vs iCloud Drive folder watch) stays open for M2."],
      "question", "unknown"),
  ];

  const wikiKnowledge: WikiKnowledgeLedger = {
    version: 1,
    generatedAt: timestamp(18),
    status: "complete",
    writingMode: "handoff",
    materials: messages.length,
    sources: Object.fromEntries(conversations.map(chat => [chat.id, {
      platform: chat.platform,
      title: chat.title,
      start: chat.updatedAt,
      end: chat.updatedAt + (chat.messageCount ?? 0) * 90_000,
    }])),
    batches: [{
      sourceIds: messages.map(message => message.id),
      status: "ok",
      units: ledgerUnits,
      rejected: {},
    }],
    decisions: {
      "u-scope-v1": { verdict: "confirmed", at: timestamp(1) },
      "u-scope-no-bot": { verdict: "confirmed", at: timestamp(1) },
      "u-scope-bot-proposal": { verdict: "rejected", at: timestamp(1) },
      "u-trans-whispercpp": { verdict: "confirmed", at: timestamp(3) },
      "u-trans-model-onboarding": { verdict: "confirmed", at: timestamp(3) },
      "u-store-sqlite": { verdict: "confirmed", at: timestamp(6) },
      "u-store-protect-edits": { verdict: "confirmed", at: timestamp(6) },
      "u-route-mapreduce": { verdict: "confirmed", at: timestamp(9) },
      "u-client-export": { verdict: "confirmed", at: timestamp(12) },
      "u-client-templates": { verdict: "confirmed", at: timestamp(12) },
      "u-price-oss": { verdict: "confirmed", at: timestamp(15) },
      "u-price-v2-open": { verdict: "open", at: timestamp(15) },
      "u-bench-diarization-open": { verdict: "open", at: timestamp(18) },
      "u-bench-ios-open": { verdict: "open", at: timestamp(18) },
    },
    organization: {
      version: 1,
      generatedAt: timestamp(18),
      status: "complete",
      projectName: translate(["墨匣 LocalNote", "LocalNote"]),
      subjects: [
        { id: "sub-scope", name: translate(["首版定位与边界", "V1 scope & exclusions"]), aliases: [], unitIds: ["u-scope-v1", "u-scope-no-bot", "u-scope-bot-proposal"] },
        { id: "sub-trans", name: translate(["本地转写引擎", "Offline transcription engine"]), aliases: [], unitIds: ["u-trans-cloud-legacy", "u-trans-whispercpp", "u-trans-model-onboarding"] },
        { id: "sub-storage", name: translate(["SQLite 存储与恢复", "SQLite storage & recovery"]), aliases: [], unitIds: ["u-store-dual-legacy", "u-store-sqlite", "u-store-protect-edits"] },
        { id: "sub-routing", name: translate(["摘要管线与时间戳", "Summary pipeline & citations"]), aliases: [], unitIds: ["u-route-mapreduce", "u-route-keychain"] },
        { id: "sub-client", name: translate(["浮窗交互与导出", "Recorder UI & export"]), aliases: [], unitIds: ["u-client-float", "u-client-export", "u-client-templates"] },
        { id: "sub-release", name: translate(["开源、压测与待决", "OSS, benchmarks & open work"]), aliases: [], unitIds: ["u-price-oss", "u-price-v2-open", "u-bench-m1", "u-bench-macos15", "u-bench-diarization-open", "u-bench-hw-tier", "u-bench-ios-open"] },
      ],
      merged: [],
      relations: [
        { older: "u-trans-cloud-legacy", newer: "u-trans-whispercpp", kind: "replaces", status: "resolved", evidence: translate(discussions[1].messages[2]) },
        { older: "u-store-dual-legacy", newer: "u-store-sqlite", kind: "replaces", status: "resolved", evidence: translate(discussions[2].messages[2]) },
        { older: "u-scope-bot-proposal", newer: "u-scope-no-bot", kind: "rejects", status: "resolved", evidence: translate(discussions[0].messages[2]) },
      ],
      chapters: [
        { id: "product-scope", title: translate(["产品定位与 V1 边界", "Product positioning & V1 scope"]), question: "", group: translate(["产品策略", "Product strategy"]), subtopics: [{ title: translate(["范围与红线", "Scope & exclusions"]), subjectIds: ["sub-scope"] }] },
        { id: architectureChapter, title: translate(["离线转写与隐私架构", "Offline transcription & privacy architecture"]), question: "", group: translate(["核心架构", "Core architecture"]), subtopics: [{ title: translate(["转写与模型", "Engine & models"]), subjectIds: ["sub-trans"] }] },
        { id: "storage-indexing", title: translate(["本地存储、检索与崩溃恢复", "Local storage, search & crash recovery"]), question: "", group: translate(["核心架构", "Core architecture"]), subtopics: [{ title: translate(["存储与恢复", "Storage & checkpoints"]), subjectIds: ["sub-storage"] }] },
        { id: "summary-routing", title: translate(["多模型路由与原声时间戳回跳", "Multi-model routing & audio citations"]), question: "", group: translate(["AI 管线", "AI pipeline"]), subtopics: [{ title: translate(["路由与校验", "Routing & guardrails"]), subjectIds: ["sub-routing"] }] },
        { id: "client-workflow", title: translate(["客户端交互与 Obsidian 导出", "Client workflow & Obsidian export"]), question: "", group: translate(["交互与导出", "UX & export"]), subtopics: [{ title: translate(["浮窗与导出", "UI & export"]), subjectIds: ["sub-client"] }] },
        { id: "pricing-verification", title: translate(["开源边界、M1 压测与待决事项", "Open-source boundary, benchmarks & open work"]), question: "", group: translate(["发布与验证", "Release & verification"]), subtopics: [{ title: translate(["开源与验证", "OSS & verification"]), subjectIds: ["sub-release"] }] },
      ],
      report: {},
    },
  };

  const session: FocusSession = {
    id: "localnote-demo",
    title: translate(["墨匣 LocalNote", "LocalNote"]),
    mode: "work",
    locale: locale === "zh" ? "zh-CN" : "en",
    sidecarWritingMode: "handoff",
    goal: translate(
      ["将跨 ChatGPT / Claude / DeepSeek / Gemini 的 7 场架构与产品讨论沉淀为可核对原话的开发规格 Wiki", "Synthesize 7 cross-AI product & architecture chats across ChatGPT, Claude, DeepSeek, and Gemini into a verifiable engineering wiki"],
    ),
    sourceConversationIds: conversations.map(chat => chat.id),
    evidence,
    sections,
    activeSectionId: architectureChapter,
    completedSectionIds: [],
    notes: "",
    createdAt: timestamp(1),
    updatedAt: timestamp(18),
    wikiKnowledge,
    sourceSignatures: Object.fromEntries(conversations.map(chat => [chat.id, Object.fromEntries(messages.filter(message => message.conversationId === chat.id).map(message => [message.id, message.contentHash]))])),
    sourceRoles: Object.fromEntries(conversations.map(chat => [chat.id, Object.fromEntries(messages.filter(message => message.conversationId === chat.id).map(message => [message.id, message.role]))])),
    sourceMessageOrder: Object.fromEntries(conversations.map(chat => [chat.id, messages.filter(message => message.conversationId === chat.id).map(message => message.id)])),
    brief: {
      summary: translate([
        "墨匣 LocalNote 是一款本地优先的 AI 播客与会议纪要桌面工具（macOS / Windows）。音频通过本地 whisper.cpp + Silero VAD 离线转写，全部字幕与纪要存入单 SQLite WAL + FTS5 事实源，摘要通过 BYOK 15 分钟分段 Map-Reduce 生成并由本地程序绑定精确原声时间戳，核心能力永久 MIT 开源。",
        "LocalNote is a local-first AI meeting & podcast notes desktop app (macOS / Windows). Audio is transcribed offline via local whisper.cpp + Silero VAD, stored in a single SQLite WAL + FTS5 database, summarized via BYOK 15-minute chunked map-reduce with deterministic millisecond audio citations, and MIT open-sourced at the core.",
      ]),
      turningPoints: [],
      confirmed: [],
      openQuestions: [],
    },
  };

  const knowledge: ProjectKnowledge = {
    session,
    conversations,
    messages,
    sourcesStale: false,
    signature: "localnote-demo-" + locale,
  };

  const basis = (messageId: string): OverviewBasis => {
    const ref = byMessage.get(messageId)!;
    const excerpt = ref.excerpt.split("\n\n", 1)[0];
    return { ref, quote: excerpt, text: excerpt };
  };

  const overview: ProjectOverviewWorkspace = {
    questions: [
      {
        id: "diarization-engine",
        text: translate(["M2 多说话人分离采用轻量 ONNX 方案还是高精度 Pyannote 方案？", "Should M2 speaker diarization use lightweight sherpa-onnx or higher-accuracy Pyannote?"]),
        kind: "writing",
        chapter: { id: "pricing-verification" },
        basis: [basis("benchmarks-2"), basis("benchmarks-1")],
        options: [
          { id: "sherpa", label: translate(["采用 sherpa-onnx（安装包仅增 40 MB，持续优化抢话切分）", "Use sherpa-onnx (+40 MB installer; iterate on overlap handling)"]), unitIds: ["u-bench-diarization-open"], basis: [basis("benchmarks-2")] },
          { id: "pyannote-addon", label: translate(["作为可选扩展包按需下载 Pyannote（避免拖累主安装包）", "Offer Pyannote as an optional on-demand add-on (+1.2 GB)"]), unitIds: ["u-bench-diarization-open"], basis: [basis("benchmarks-2")] },
        ],
      },
      {
        id: "v2-pricing-model",
        text: translate(["V2 端到端加密同步与播客 RSS 自动追更采用买断制还是订阅制？", "Should V2 E2EE sync and podcast RSS auto-fetch use a one-time license or subscription?"]),
        kind: "writing",
        chapter: { id: "pricing-verification" },
        basis: [basis("pricing-2"), basis("pricing-1")],
        options: [
          { id: "one-time", label: translate(["个人买断 Pro 许可证（贴合本地优先用户的付费习惯）", "One-time personal Pro license (matches local-first audience expectations)"]), unitIds: ["u-price-v2-open"], basis: [basis("pricing-1")] },
          { id: "hybrid", label: translate(["本地增强买断 + 云端 E2EE 中继流量按年订阅", "One-time license for local Pro features + annual plan for E2EE relay"]), unitIds: ["u-price-v2-open"], basis: [basis("pricing-2")] },
        ],
      },
      {
        id: "ios-audio-sync",
        text: translate(["iOS 手机录音传回桌面端优先支持局域网扫码还是 iCloud Drive 监听？", "Should iOS audio transfer to desktop prioritize LAN QR transfer or iCloud Drive folder watch?"]),
        kind: "writing",
        chapter: { id: "pricing-verification" },
        basis: [basis("benchmarks-4")],
        options: [
          { id: "lan-qr", label: translate(["局域网扫码直传（跨 Windows/macOS 通用，零第三方云依赖）", "LAN QR direct transfer (works on both Windows & macOS, zero cloud dependency)"]), unitIds: ["u-bench-ios-open"], basis: [basis("benchmarks-4")] },
          { id: "icloud", label: translate(["监听指定 iCloud Drive 文件夹（macOS 生态无感同步）", "Watch a chosen iCloud Drive folder (seamless for macOS + iOS users)"]), unitIds: ["u-bench-ios-open"], basis: [basis("benchmarks-4")] },
        ],
      },
    ],
    decisions: sections.flatMap(chapter => chapter.claims.filter(claim => claim.userDecided).map((claim, index) => ({
      id: chapter.id + "-" + index,
      text: claim.text,
      chapter: { id: chapter.id },
      choice: undefined,
      receiptId: undefined,
      basis: claim.evidenceIds.map(id => basis(id.slice("source-".length))),
    }))),
    plan: undefined,
    planChoices: {},
    planChapters: {},
    chapterCards: overviewChapterCards(session, locale === "zh"),
  };

  return { knowledge, overview };
}
