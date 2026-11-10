#!/usr/bin/env node
/**
 * 包装 tauri CLI：
 *  1. 把便携 mingw 的 bin 前置到 PATH，让 cargo 能找到 x86_64-w64-mingw32-gcc
 *  2. 载入 .env.local（存在时），使本地构建也能读到签名密钥
 *
 * 用法：node scripts/run.mjs dev | build [-- 其它 tauri 参数]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const SEP = process.platform === "win32" ? ";" : ":";

const mingwBin =
  process.env.MIDITOOL_MINGW ?? path.join(os.homedir(), ".mingw64", "mingw64", "bin");
const cargoBin = path.join(os.homedir(), ".cargo", "bin");

if (!fs.existsSync(path.join(mingwBin, "gcc.exe"))) {
  console.error(`找不到 mingw gcc：${mingwBin}\\gcc.exe`);
  console.error("请先运行：node scripts/setup-mingw.mjs");
  process.exit(1);
}

if (!fs.existsSync(path.join(cargoBin, "cargo.exe"))) {
  console.error(`找不到 cargo：${cargoBin}\\cargo.exe`);
  console.error("请先安装 Rust：https://rustup.rs");
  process.exit(1);
}

const env = {
  ...process.env,
  PATH: `${mingwBin}${SEP}${cargoBin}${SEP}${process.env.PATH ?? ""}`,
};

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
    if (!(key in env)) env[key] = value;
  }
}

const args = process.argv.slice(2);
const child = spawn("npx", ["tauri", ...args], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 1));
