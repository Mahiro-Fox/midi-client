#!/usr/bin/env node
/**
 * 包装 tauri CLI：
 *  1. 自动定位可用的 mingw（便携版 → 环境变量 → 系统 PATH），都找不到才报错
 *  2. 载入 .env.local（存在时），使本地构建也能读到签名密钥
 *
 * 用法：node scripts/run.mjs dev | build [-- 其它 tauri 参数]
 *
 * 环境变量：
 *   MIDITOOL_MINGW   mingw 的 bin 目录（CI 上指向 C:\msys64\ucrt64\bin）
 *   MIDITOOL_CARGO   rustup 的 bin 目录（默认 ~/.cargo/bin）
 *
 * 设计要点：本地靠便携 mingw，CI 靠 MSYS2/PATH —— 两条路都能走，
 * 缺少某个目录时降级而不是直接退出，否则 GitHub Actions 上必然失败。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const isWin = process.platform === "win32";
const SEP = isWin ? ";" : ":";
const EXE = isWin ? ".exe" : "";

const TRIPLET_CC = [`x86_64-w64-mingw32-gcc${EXE}`];
const ANY_CC = [...TRIPLET_CC, `gcc${EXE}`];
const TRIPLET_AR = [`x86_64-w64-mingw32-ar${EXE}`];
const ANY_AR = [...TRIPLET_AR, `ar${EXE}`];

const mingwCandidates = [
  process.env.MIDITOOL_MINGW,
  path.join(os.homedir(), ".mingw64", "mingw64", "bin"),
].filter(Boolean);

const cargoDir = process.env.MIDITOOL_CARGO ?? path.join(os.homedir(), ".cargo", "bin");

const hasAny = (dir, names) => names.some((n) => fs.existsSync(path.join(dir, n)));

/** 在给定的 PATH 字符串里查找第一个存在的可执行文件，返回绝对路径 */
function resolveInPath(pathValue, names) {
  for (const dir of (pathValue ?? "").split(SEP)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// ---- mingw：优先便携版目录，其次系统 PATH（CI / 自制环境）----
const portableMingw = mingwCandidates.find((d) => hasAny(d, ANY_CC)) ?? null;
const pathGcc = portableMingw ? null : resolveInPath(process.env.PATH, ANY_CC);

if (!portableMingw && !pathGcc) {
  console.error("找不到 mingw 的 gcc。");
  console.error("  本地：npm run setup:mingw   （安装到 %USERPROFILE%\\.mingw64）");
  console.error("  其它：设置 MIDITOOL_MINGW 指向 mingw 的 bin 目录，或把 gcc 放进 PATH");
  console.error(`  已尝试：${mingwCandidates.join(", ") || "(无)"}`);
  process.exit(1);
}

// ---- cargo：同上，rustup 默认在 ~/.cargo/bin，CI 上通常已在 PATH ----
const hasPortableCargo = hasAny(cargoDir, [`cargo${EXE}`]);
const pathCargo = hasPortableCargo ? null : resolveInPath(process.env.PATH, [`cargo${EXE}`]);

if (!hasPortableCargo && !pathCargo) {
  console.error(`找不到 cargo（已尝试 ${cargoDir} 与 PATH）。`);
  console.error("请先安装 Rust：https://rustup.rs");
  process.exit(1);
}

const prepend = [];
if (portableMingw) prepend.push(portableMingw);
if (hasPortableCargo) prepend.push(cargoDir);

const env = {
  ...process.env,
  PATH: [...prepend, process.env.PATH ?? ""].filter(Boolean).join(SEP),
};

// ---- .cargo/config.toml 写的是三元组名字（x86_64-w64-mingw32-gcc），
//      系统 PATH 上只有裸 gcc 时用环境变量覆盖，cargo 认这两个变量名 ----
const ENV_PREFIX = "CARGO_TARGET_X86_64_PC_WINDOWS_GNU";
const tripletCc = resolveInPath(env.PATH, TRIPLET_CC);
const crossCc = tripletCc ?? resolveInPath(env.PATH, ANY_CC);
if (crossCc && !tripletCc) {
  env[`${ENV_PREFIX}_LINKER`] = crossCc;
}

if (!resolveInPath(env.PATH, TRIPLET_AR)) {
  const crossAr = resolveInPath(env.PATH, ANY_AR);
  if (crossAr) env[`${ENV_PREFIX}_AR`] = crossAr;
}

const toolchainNote = portableMingw
  ? `便携 mingw ${portableMingw}`
  : `系统 mingw ${crossCc}`;
console.log(`[run] ${toolchainNote}${isWin ? "" : " （非 Windows 平台，仅透传）"}`);

// ---- .env.local（本地签名密钥等；CI 通过 Secrets 注入，文件不存在）----
const envFile = path.join(projectRoot, ".env.local");
if (fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    // 已存在的环境变量优先（CI Secrets > 本地文件）
    if (!(key in env)) env[key] = value;
  }
}

// ---- 签名私钥容错：.env.local 里常写成相对路径（.tauri\miditool.key），
//      而 tauri 的签名步骤不保证以项目根为 cwd，这里统一转绝对路径。
//      真密钥是单行 base64（约 350 字符），靠长度 + existsSync 双重判断避免误当路径。----
const keyValue = env.TAURI_SIGNING_PRIVATE_KEY;
if (keyValue && keyValue.length < 260 && !keyValue.includes("\n")) {
  const asPath = path.isAbsolute(keyValue) ? keyValue : path.resolve(projectRoot, keyValue);
  if (fs.existsSync(asPath)) env.TAURI_SIGNING_PRIVATE_KEY = asPath;
}

const args = process.argv.slice(2);
const child = spawn("npx", ["tauri", ...args], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  shell: isWin,
});

child.on("exit", (code) => process.exit(code ?? 1));
