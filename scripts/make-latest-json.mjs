// 生成本地发布用的 latest.json（CI 由 tauri-action 自动生成，本地打包时用它补齐）
// 用法：node scripts/make-latest-json.mjs [tag]
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
const tag = process.argv[2] || `v${version}`;
const repo = "Mahiro-Fox/MIDITOOL";
const dir = join(root, "src-tauri/target/release/bundle/nsis");

if (!existsSync(dir)) {
  console.error(`找不到 ${dir}，请先执行 npm run app:build`);
  process.exit(1);
}

// 优先挑与当前版本号匹配的安装包，避免打包目录里残留旧版本时取错文件
const setups = readdirSync(dir).filter((f) => f.endsWith("-setup.exe"));
if (setups.length === 0) {
  console.error("没有找到 NSIS 安装包");
  process.exit(1);
}
const exact = `MIDITOOL_${version}_x64-setup.exe`;
const setup = setups.includes(exact)
  ? exact
  : setups
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0].f;
if (setup !== exact) {
  console.warn(`注意：未找到 ${exact}，改用最新的 ${setup}`);
}
const sigPath = join(dir, `${setup}.sig`);
if (!existsSync(sigPath)) {
  console.error("缺少 .sig 签名文件：打包时需要设置 TAURI_SIGNING_PRIVATE_KEY");
  process.exit(1);
}

const latest = {
  version,
  notes: `MIDITOOL v${version}`,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(sigPath, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${setup}`,
    },
  },
};

const out = join(dir, "latest.json");
writeFileSync(out, `${JSON.stringify(latest, null, 2)}\n`);
console.log(`已生成 ${out}`);
console.log(`上传时请把 ${setup}、${setup}.sig、latest.json 一起放到 Release ${tag}`);
