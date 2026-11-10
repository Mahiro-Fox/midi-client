#!/usr/bin/env node
/**
 * 在无管理员权限、无 MSVC 的机器上安装便携版 mingw-w64 工具链。
 *
 * 用法：
 *   node scripts/setup-mingw.mjs [目标目录]
 *   默认目标目录：%USERPROFILE%\.mingw64，最终 gcc 位于 <目标目录>\mingw64\bin
 *
 * 为什么不用 winlibs：其发布包托管在 GitHub Releases，国内经常被限速到
 * 几十 KB/s（263MB 需数小时）。这里改为直接从清华 MSYS2 镜像拉取官方包，
 * 速度通常在 MB/s 级别，且包体只含真正需要的组件。
 *
 * 依赖 Node.js 22.15+（需要 zlib.zstdDecompressSync 解压 .pkg.tar.zst）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";

const MIRROR = "https://mirrors.tuna.tsinghua.edu.cn/msys2/mingw/mingw64";
const ROOT = path.resolve(process.argv[2] ?? path.join(os.homedir(), ".mingw64"));
const CACHE = path.join(ROOT, ".cache");

/** gcc 及其运行时依赖的起点，其余依赖从包内 .PKGINFO 递归解析 */
const SEED = [
  "mingw-w64-x86_64-gcc",
  "mingw-w64-x86_64-gcc-libs",
  "mingw-w64-x86_64-binutils",
  "mingw-w64-x86_64-crt",
  "mingw-w64-x86_64-headers",
];

if (typeof zlib.zstdDecompressSync !== "function") {
  console.error(`需要 Node.js 22.15 以上版本才能解压 .pkg.tar.zst，当前 ${process.version}`);
  process.exit(1);
}

async function indexPackages() {
  const res = await fetch(`${MIRROR}/`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`镜像目录读取失败：HTTP ${res.status}`);
  const html = await res.text();

  const map = new Map();
  const re = /(mingw-w64-x86_64-[a-z0-9_+.-]+?)-(\d[^"'/]*)\.pkg\.tar\.zst/g;
  for (const m of html.matchAll(re)) {
    // 镜像按名称+版本排序，后出现的视为更新版本
    map.set(m[1], `${m[1]}-${m[2]}.pkg.tar.zst`);
  }
  return map;
}

async function download(fileName) {
  const target = path.join(CACHE, fileName);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return target;

  const res = await fetch(`${MIRROR}/${fileName}`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`下载 ${fileName} 失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, buf);
  process.stdout.write(`  ↓ ${fileName} (${(buf.length / 1048576).toFixed(1)} MB)\n`);
  return target;
}

/** 解压 .pkg.tar.zst 到 ROOT，返回包内的 depends 列表 */
function extract(fileName) {
  const archive = path.join(CACHE, fileName);
  const tarPath = archive.replace(/\.zst$/, "");
  if (!fs.existsSync(tarPath)) {
    fs.writeFileSync(tarPath, zlib.zstdDecompressSync(fs.readFileSync(archive)));
  }
  // Windows 自带 bsdtar 不支持 zstd，但能处理已解压的 tar
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
    ["-xf", tarPath, "-C", ROOT], { stdio: "pipe" });

  const pkginfo = path.join(ROOT, ".PKGINFO");
  const deps = [];
  if (fs.existsSync(pkginfo)) {
    for (const line of fs.readFileSync(pkginfo, "utf8").split("\n")) {
      const m = /^depend\s*=\s*([a-z0-9_+.-]+)/i.exec(line.trim());
      if (m) deps.push(m[1]);
    }
    fs.rmSync(pkginfo, { force: true });
  }
  fs.rmSync(tarPath, { force: true });
  fs.rmSync(path.join(ROOT, ".BUILDINFO"), { force: true });
  fs.rmSync(path.join(ROOT, ".MTREE"), { force: true });
  return deps;
}

const index = await indexPackages();
console.log(`镜像索引完成，共 ${index.size} 个包`);

const queue = [...SEED];
const seen = new Set();
let count = 0;

while (queue.length > 0) {
  const name = queue.shift();
  if (seen.has(name)) continue;
  seen.add(name);

  const fileName = index.get(name);
  if (!fileName) {
    console.log(`  - 跳过 ${name}（镜像中不存在）`);
    continue;
  }

  const archive = await download(fileName);
  const deps = extract(fileName);
  count += 1;
  for (const d of deps) if (!seen.has(d)) queue.push(d);
}

const bin = path.join(ROOT, "mingw64", "bin");
const gcc = path.join(bin, "gcc.exe");
if (!fs.existsSync(gcc)) {
  console.error(`\n安装未完成：${gcc} 不存在`);
  process.exit(1);
}

const version = execFileSync(gcc, ["--version"], { encoding: "utf8" }).split("\n")[0];
fs.rmSync(CACHE, { recursive: true, force: true });

console.log(`\n完成：共安装 ${count} 个包`);
console.log(`gcc: ${version}`);
console.log(`请把下面这个目录加入 PATH（或用 scripts/build.ps1 自动处理）：`);
console.log(bin);
