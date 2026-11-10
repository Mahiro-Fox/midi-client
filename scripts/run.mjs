#!/usr/bin/env node
/**
 * 包装 tauri CLI，抹平「本机」和「CI」的工具链差异：
 *
 *   本机：没有 MSVC，靠便携 mingw + windows-gnu 工具链
 *   CI  ：runner 自带 MSVC，不碰 mingw（与 lan-room 的 workflow 一致）
 *
 * 判断依据是「有没有找到 mingw」：
 *   找到  -> 前置进 PATH、RUSTUP_TOOLCHAIN 切到 windows-gnu、必要时覆盖 linker
 *   没找到 -> 原样交给 cargo，用它默认的工具链（CI 上是 msvc）
 *
 * 另外会载入 .env.local，并把其中的相对路径私钥转成绝对路径。
 *
 * 用法：node scripts/run.mjs dev | build [-- 其它 tauri 参数]
 *
 * 环境变量：
 *   MIDITOOL_MINGW   mingw 的 bin 目录（默认找 ~/.mingw64/mingw64/bin）
 *   MIDITOOL_CARGO   rustup 的 bin 目录（默认 ~/.cargo/bin）
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const isWin = process.platform === "win32";
const SEP = isWin ? ";" : ":";
const EXE = isWin ? ".exe" : "";

const GNU_TOOLCHAIN = "stable-x86_64-pc-windows-gnu";

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

// ---- mingw：可选。本机靠它绕开 MSVC，CI 上不存在也不需要 ----
const mingwDir = mingwCandidates.find((d) => hasAny(d, ANY_CC)) ?? null;
if (process.env.MIDITOOL_MINGW && !mingwDir) {
  console.warn(`[run] MIDITOOL_MINGW 指向的目录里没有 gcc：${process.env.MIDITOOL_MINGW}`);
}

// ---- cargo：rustup 默认 ~/.cargo/bin，CI 上通常已在 PATH ----
const portableCargo = hasAny(cargoDir, [`cargo${EXE}`]) ? cargoDir : null;
if (!portableCargo && !resolveInPath(process.env.PATH, [`cargo${EXE}`])) {
  console.error(`找不到 cargo（已尝试 ${cargoDir} 与 PATH）。`);
  console.error("请先安装 Rust：https://rustup.rs");
  process.exit(1);
}

const prepend = [mingwDir, portableCargo].filter(Boolean);
const env = {
  ...process.env,
  PATH: [...prepend, process.env.PATH ?? ""].filter(Boolean).join(SEP),
};

if (mingwDir) {
  // 便携 mingw 只在「没有 MSVC」的机器上装，出现即意味着要走 windows-gnu。
  // 用 RUSTUP_TOOLCHAIN 指定，优先级高于 rust-toolchain.toml（仓库里已不放该文件）。
  env.RUSTUP_TOOLCHAIN = GNU_TOOLCHAIN;

  // .cargo/config.toml 写的是三元组名字；PATH 上只有裸 gcc/ar 时用环境变量覆盖，
  // 这两个变量名是 cargo 的约定，优先级高于 config.toml。
  const ENV_PREFIX = "CARGO_TARGET_X86_64_PC_WINDOWS_GNU";
  const tripletCc = resolveInPath(env.PATH, TRIPLET_CC);
  const anyCc = tripletCc ?? resolveInPath(env.PATH, ANY_CC);
  if (anyCc && !tripletCc) env[`${ENV_PREFIX}_LINKER`] = anyCc;
  if (!resolveInPath(env.PATH, TRIPLET_AR)) {
    const anyAr = resolveInPath(env.PATH, ANY_AR);
    if (anyAr) env[`${ENV_PREFIX}_AR`] = anyAr;
  }

  console.log(`[run] mingw ${mingwDir} → ${GNU_TOOLCHAIN}`);
} else {
  console.log("[run] 未找到便携 mingw，交给 cargo 默认工具链（CI / MSVC 模式）");
}

// ---- 签名私钥容错：.env.local 里常写成相对路径（.tauri\miditool.key），
//      而 tauri 的签名步骤不保证以项目根为 cwd，这里统一转绝对路径。
//      真密钥是单行 base64（约 350 字符），靠长度 + existsSync 双重判断避免误当路径。----
function normalizeSigningKey() {
  const value = env.TAURI_SIGNING_PRIVATE_KEY;
  if (!value || value.length >= 260 || value.includes("\n")) return;
  const asPath = path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
  if (fs.existsSync(asPath)) env.TAURI_SIGNING_PRIVATE_KEY = asPath;
}

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
normalizeSigningKey();

const args = process.argv.slice(2);
const child = spawn("npx", ["tauri", ...args], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  shell: isWin,
});

child.on("exit", (code) => process.exit(code ?? 1));
