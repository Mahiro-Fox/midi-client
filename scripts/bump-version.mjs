// 精确修改版本号，避免全局替换误伤依赖版本
//
// 用法：
//   node scripts/bump-version.mjs 0.1.2        # 指定版本
//   node scripts/bump-version.mjs patch        # 0.1.1 -> 0.1.2（也支持 minor / major）
//   node scripts/bump-version.mjs 0.1.2 --dry-run
//
// 只会改这些位置：
//   package.json                     version
//   package-lock.json                根 version + packages[""].version
//   src-tauri/tauri.conf.json         version        <- 安装包 / latest.json / 更新器的唯一真相源
//   src-tauri/Cargo.toml              [package] version
//   src-tauri/Cargo.lock              name = "midi-client" 那一条
// 第三方依赖的版本一律不碰（byteorder-lite / vswhom 之类也是 0.1.x，改了会让项目编译不了）。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const input = args.find((a) => !a.startsWith("-"));

const P = {
  pkg: join(root, "package.json"),
  pkgLock: join(root, "package-lock.json"),
  tauriConf: join(root, "src-tauri/tauri.conf.json"),
  cargoToml: join(root, "src-tauri/Cargo.toml"),
  cargoLock: join(root, "src-tauri/Cargo.lock"),
};

// 统一按 LF 做匹配，写回时还原该文件原本的换行符（仓库里 CRLF / LF 混用）
function load(path) {
  const raw = readFileSync(path, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return { path, eol, text: raw.replace(/\r\n/g, "\n") };
}

function save(file, text) {
  writeFileSync(file.path, file.eol === "\n" ? text : text.replace(/\n/g, file.eol));
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const JSON_ROOT_VER = /(^  "version": ")[^"]*(")/m; // 只匹配顶层键，不动嵌套
const CARGO_TOML_VER = /(^\[package\][\s\S]*?^version\s*=\s*")[^"]*(")/m;
const CARGO_LOCK_VER = /(\[\[package\]\]\nname = "midi-client"\nversion = ")[^"]*(")/;
const NPM_ROOT_VER = /(\{\n  "name": "midi-client",\n  "version": ")[^"]*(")/;
const NPM_PKG0_VER = /(\n    "": \{\n      "name": "midi-client",\n      "version": ")[^"]*(")/;

// ---- 当前版本 + 一致性预检 ----
const files = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, load(v)]));
const current = {
  "package.json": JSON.parse(files.pkg.text).version,
  "src-tauri/tauri.conf.json": JSON.parse(files.tauriConf.text).version,
  "src-tauri/Cargo.toml": (files.cargoToml.text.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m) || [])[1],
};

const versions = Object.values(current);
if (versions.some((v) => !v)) {
  console.error("读取当前版本失败，请检查 package.json / tauri.conf.json / Cargo.toml 是否完好");
  process.exit(1);
}
const baseline = versions[0];
if (new Set(versions).size > 1) {
  console.warn("⚠ 当前版本号已经不一致：");
  for (const [f, v] of Object.entries(current)) console.warn(`    ${f}: ${v}`);
}

if (!input) {
  console.log(`当前版本（以 tauri.conf.json 为基准）：${baseline}`);
  console.log("用法：node scripts/bump-version.mjs <x.y.z|patch|minor|major> [--dry-run]");
  process.exit(0);
}

// ---- 计算目标版本 ----
let next = input;
if (["patch", "minor", "major"].includes(input)) {
  const [maj, min, pat] = baseline.split("-")[0].split(".").map(Number);
  next =
    input === "major"
      ? `${maj + 1}.0.0`
      : input === "minor"
        ? `${maj}.${min + 1}.0`
        : `${maj}.${min}.${pat + 1}`;
}
if (!SEMVER.test(next)) {
  console.error(`版本号格式不对：${next}（需要 x.y.z）`);
  process.exit(1);
}
if (next === baseline) {
  console.log(`版本已经是 ${next}，无需修改`);
  process.exit(0);
}

const changed = [];
function apply(label, file, text) {
  if (text === file.text) return true;
  changed.push(label);
  if (!dryRun) save(file, text);
  return true;
}

// ---- package.json ----
if (!JSON_ROOT_VER.test(files.pkg.text)) {
  console.error("package.json 中没找到顶层 version");
  process.exit(1);
}
apply("package.json", files.pkg, files.pkg.text.replace(JSON_ROOT_VER, `$1${next}$2`));

// ---- src-tauri/tauri.conf.json ----
if (!JSON_ROOT_VER.test(files.tauriConf.text)) {
  console.error("tauri.conf.json 中没找到顶层 version");
  process.exit(1);
}
apply("src-tauri/tauri.conf.json", files.tauriConf, files.tauriConf.text.replace(JSON_ROOT_VER, `$1${next}$2`));

// ---- src-tauri/Cargo.toml ----
if (!CARGO_TOML_VER.test(files.cargoToml.text)) {
  console.error("Cargo.toml 中没找到 [package] version");
  process.exit(1);
}
apply("src-tauri/Cargo.toml", files.cargoToml, files.cargoToml.text.replace(CARGO_TOML_VER, `$1${next}$2`));

// ---- package-lock.json ----
{
  let text = files.pkgLock.text.replace(NPM_ROOT_VER, `$1${next}$2`);
  if (text === files.pkgLock.text) {
    console.error("package-lock.json 中没找到根版本号");
    process.exit(1);
  }
  text = text.replace(NPM_PKG0_VER, `$1${next}$2`);
  apply("package-lock.json", files.pkgLock, text);
}

// ---- src-tauri/Cargo.lock ----
if (!CARGO_LOCK_VER.test(files.cargoLock.text)) {
  console.error('Cargo.lock 中没找到 name = "midi-client" 的版本条目');
  process.exit(1);
}
apply("src-tauri/Cargo.lock", files.cargoLock, files.cargoLock.text.replace(CARGO_LOCK_VER, `$1${next}$2`));

console.log(`${dryRun ? "[dry-run] 将修改" : "已更新"} ${changed.length} 处（目标版本 ${next}）：`);
if (changed.length === 0) console.log("  （没有文件需要改动）");
for (const f of changed) console.log(`  · ${f}`);

// ---- 写入后校验 ----
if (!dryRun) {
  const checks = [
    ["package.json", () => JSON.parse(load(P.pkg).text).version === next],
    ["src-tauri/tauri.conf.json", () => JSON.parse(load(P.tauriConf).text).version === next],
    [
      "src-tauri/Cargo.toml",
      () =>
        new RegExp(`^\\[package\\][\\s\\S]*?^version\\s*=\\s*"${next.replace(/\./g, "\\.")}"`, "m").test(
          load(P.cargoToml).text,
        ),
    ],
    [
      "package-lock.json",
      () => {
        const t = load(P.pkgLock).text;
        return (
          t.startsWith(`{\n  "name": "midi-client",\n  "version": "${next}"`) &&
          t.includes(`\n    "": {\n      "name": "midi-client",\n      "version": "${next}"`)
        );
      },
    ],
    [
      "src-tauri/Cargo.lock",
      () =>
        new RegExp(`\\[\\[package\\]\\]\\nname = "midi-client"\\nversion = "${next.replace(/\./g, "\\.")}"`).test(
          load(P.cargoLock).text,
        ),
    ],
  ];
  const bad = checks.filter(([, fn]) => !fn()).map(([n]) => n);
  if (bad.length) {
    console.error(`❌ 校验失败：${bad.join(", ")} 未写入成功，请手动检查`);
    process.exit(1);
  }
  console.log(`✔ 全部一致，可以提交`);
  console.log(`\n下一步：`);
  console.log(`  git commit -am "chore: bump to ${next}"`);
  console.log(`  git tag v${next} && git push origin main --tags`);
}
