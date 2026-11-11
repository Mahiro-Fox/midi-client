# midi-client

MIDI 远程控制器。从远程曲库拉取 MIDI 曲谱，实时推送到本地 MIDI 输出端口（如 loopMIDI 虚拟端口），供 DAW / 软音源发声。

这是原 Python（tkinter + mido）版本的完整重写：界面换成 React + Tailwind，播放引擎换成 Rust，并加入自动更新。

## 曲库来源

界面顶部用标签栏切换，两个源的数据模型不同，但都归一到同一个 `TrackItem`（`src/lib/tracks.ts`），
分页参数也由 `src/lib/library.ts` 抹平，共用一套虚拟列表 + 滚动加载。

| 源 | 接口 | 特点 |
|---|---|---|
| 原曲库 | `mahirooyama.cn/api/midi?search=&page=&limit=` | 分页（40/页，共 139 首），服务端搜索，按修改时间倒序 |
| 星穹音乐厅 | `celestia.chiooone.com/concert/api/songs?q=&sort=&offset=&limit=` | 分页（40/页，共 259 首），服务端搜索与排序，带时长 / 上传者 |

两个源的参数语义不同（原曲库传页码，星穹传条目偏移），`loadTrackPage` 统一按「第几页」调用。
原曲库响应里的 `pagination` 是必需字段，服务端分页信息直接透给前端，客户端不做二次切片。

星穹音乐厅的曲谱是自定义 **DPS1** 文本格式，不是标准 MIDI 文件：

```
DPS1\t<id>\t<title>\t<事件数>
<逐事件毫秒增量，逗号分隔>
<逐事件打包值 类型<<16 | 数据1<<8 | 数据2>
```

类型 1 = NoteOn（数据1 音高，数据2 力度）、2 = NoteOff、3 = 控制器（如 64 = 延音踏板）。
`midi.rs` 的 `build_timeline` 按内容嗅探：首 4 字节是 `DPS1` 就走 `build_dps_timeline`，
否则按标准 MIDI 交给 `midly`。两条路最终都产出同一份「绝对时间 + 原始 MIDI 字节」的时间轴，
因此调度、清音、进度节流全部复用。

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Tauri 2 |
| 前端 | React 19 + TypeScript + Tailwind CSS 4 + Vite |
| UI 组件 | shadcn/ui（new-york 风格，`src/components/ui`） |
| 图标 | lucide-react |
| 长列表 | `@tanstack/react-virtual`（虚拟滚动，只渲染可视区） |
| 提示 / 弹窗 | sonner + Radix Dialog / Tabs |
| MIDI 解析 | `midly`（标准 MIDI）+ 自写 DPS1 解析器 |
| MIDI 输出 | `midir`（Windows 走 WinMM，与 mido/python-rtmidi 同源） |
| 网络 | `reqwest`（Windows SChannel，无需 OpenSSL） |
| 更新 | `tauri-plugin-updater`（minisign 签名） |

## 界面结构

- **主题**：`src/index.css` 里保留 `ink-*` / `brand-*` 调色板，同时把 shadcn 的语义变量
  （`--background` / `--primary` / `--border` …）直接赋成暗色值。应用只有暗色，`<html class="dark">`
  保证 shadcn 组件里的 `dark:` 分支生效，视觉与改造前一致。
- **虚拟列表**：曲库 139 首以上，列表用固定行高 44px 虚拟化，只渲染可视区 + 12 行 overscan。
  「定位当前曲目」不是 `scrollIntoView`，而是 `virtualizer.scrollToIndex(index, { align: "center" })`，
  这样目标行还没挂载也能滚到位，随后叠一层 1.25s 光圈提示。
- **播放只认图标**：列表行是不可点的容器，只有右侧播放按钮触发播放，避免误触整行。
- **新增组件**：`npx shadcn@latest add <name>` 即可，别名 `@/components/ui`；`cn()` 在 `src/lib/utils.ts`。

## 编译环境

Rust 侧固定用 MSVC：`stable-x86_64-pc-windows-msvc`（rustup 在 Windows 上的默认目标），
链接器来自 Visual Studio Build Tools，不需要额外配置或被 `rust-toolchain.toml` 钉死的工具链。

```powershell
# 装过 VS / VS Build Tools（含「使用 C++ 的桌面开发」）即可
rustup default stable-x86_64-pc-windows-msvc   # 通常已是默认值
```

## 快速开始

```bash
# 1. 安装前端依赖
npm install

# 2. 开发（热重载）
npm run app:dev

# 3. 打包
npm run app:build
```

产物在 `src-tauri/target/release/bundle/nsis/`。

## 自动更新

密钥对已生成：

| 用途 | 位置 |
|---|---|
| 私钥（勿外泄） | `C:\Users\fjkj\.tauri\midi-client.key` |
| 公钥 | 已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` |
| 本地构建用环境变量 | `.env.local`（已 gitignore） |

`scripts/run.mjs` 会在构建前自动载入 `.env.local`，所以本地打包出来的安装包同样带签名，可直接作为更新源。

### 上传到 GitHub 前：配置 Secrets

```powershell
gh secret set TAURI_SIGNING_PRIVATE_KEY --body (Get-Content $env:USERPROFILE\.tauri\midi-client.key -Raw)
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body "<.env.local 里的密码>"
```

没有 `gh` 就在仓库 Settings → Secrets and variables → Actions 里手动添加同名变量。

> 密码丢失或私钥泄露都会导致更新链断裂，请把私钥和密码一起离线备份。

### 发布新版本

```bash
# 1. 一处改全：同步 package.json / 锁文件 / tauri.conf.json / Cargo.toml / Cargo.lock
npm run bump patch          # 或 minor / major / 0.2.0；加 --dry-run 先看要改哪些

# 2. 提交并打标签
git commit -am "chore: release v$(node -p "require('./package.json').version")"
git tag "v$(node -p "require('./package.json').version")"
git push origin main --tags
```

`release.yml` 自动上传安装包、`.exe.sig` 和 `latest.json`。
客户端「检查更新」读取的正是 `releases/latest/download/latest.json`。

CI 侧同样是 MSVC（`windows-latest` 自带 VS Build Tools），和本地只有一套工具链。
workflow 里额外加了一步「tag 与 `tauri.conf.json` 版本一致」的校验——版本对不上会让
`latest.json` 指向错误的安装包，不如在编译前就 fail 掉。

> 改 workflow 之后必须重打 tag 再推，因为 tag 触发的流水线用的是**该 tag 指向提交里**的 YAML。

如果想在本地手动传 Release，打完包后执行 `npm run release:latest`，
它会在 `src-tauri/target/release/bundle/nsis/` 下生成 `latest.json`，
把安装包、`.sig` 和它一起上传即可。

## 与 Python 版本的对应

| 原实现 | 现实现 | 备注 |
|---|---|---|
| `tkinter` 界面 | React + Tailwind | |
| `requests` | `reqwest` | 曲库地址与接口格式保持不变 |
| `mido` 解析 | `midly` | 需自行按 tempo map 换算时长 |
| `mido` + `python-rtmidi` | `midir` | 同一 RtMidi 血统 |
| `notifypy` | 应用内 toast | 前台应用没必要再弹系统通知 |
| `filedialog` | `tauri-plugin-dialog` | |
| `threading` + `Event` | `std::thread` + `AtomicBool` | |

## 实现上值得留意的几点

- **进度事件节流**：`playback://progress` 每 100 ms 最多发一次。原始实现每发一条 MIDI 消息就刷一次 UI，在 Tauri 里跨进程序列化会被打成 IPC 洪水。
- **绝对时间调度**：不按 delta 逐条 `sleep`，而是记录起点、睡到绝对目标时刻，避免误差累积；Windows 定时器精度默认 15.6 ms，末尾 2 ms 改为自旋等待。
- **防卡音符**：停止、出错、关窗时都会对 16 个通道发 CC123（All Notes Off）、CC121 和弯音回中，避免软音源留下长音。
- **代次校验**：连续切换曲目时，旧播放线程的收尾事件会被丢弃，避免进度条和状态回跳。
