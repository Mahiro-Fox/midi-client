#!/usr/bin/env node
/**
 * 包装 tauri CLI，只做两件事：
 *
 *   1. 载入 .env.local（本地签名私钥与密码；CI 通过 Secrets 注入，文件不存在就跳过）
 *   2. 把参数原样转给 tauri
 *
 * 构建工具链不再做任何探测：本机与 CI 都走 rustup 默认的
 * stable-x86_64-pc-windows-msvc。
 *
 * 用法：node scripts/run.mjs dev | build [-- 其它 tauri 参数]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const isWin = process.platform === "win32";

const env = { ...process.env };

// ---- .env.local（本地签名密钥等）----
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

// 私钥在 .env.local 里写成相对仓库根的路径，而打包签名不保证以仓库根为 cwd，
// 这里统一转成绝对路径。真密钥是单行 base64（约 350 字符），靠长度判别，不当路径处理。
const keyPath = env.TAURI_SIGNING_PRIVATE_KEY;
if (keyPath && keyPath.length < 260 && !keyPath.includes("\n")) {
  const absolute = path.isAbsolute(keyPath) ? keyPath : path.resolve(projectRoot, keyPath);
  if (fs.existsSync(absolute)) env.TAURI_SIGNING_PRIVATE_KEY = absolute;
}

const child = spawn("npx", ["tauri", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  shell: isWin,
});

child.on("exit", (code) => process.exit(code ?? 1));
