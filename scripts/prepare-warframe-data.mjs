// 构建期裁剪 warframe-public-export-plus 数据，供战绩分析页（/log）使用：
// - ExportRegions.json 只保留节点展示/任务类型识别需要的字段
// - dict.zh.json 只保留 ExportRegions 引用到的翻译 key
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const srcRegions = path.join(repoRoot, "warframe-public-export-plus", "ExportRegions.json");
const srcDict = path.join(repoRoot, "warframe-public-export-plus", "dict.zh.json");

const outDir = path.join(repoRoot, "web", "public", "warframe-public-export-plus");
mkdirSync(outDir, { recursive: true });

const regions = JSON.parse(readFileSync(srcRegions, "utf8"));
const dict = JSON.parse(readFileSync(srcDict, "utf8"));

// 只保留页面/解析器用到的字段，并收集需要翻译的 key
const REGION_FIELDS = ["name", "systemName", "missionType", "missionName", "factionName"];
const DICT_FIELDS = ["name", "systemName", "missionName", "factionName"];

const slimRegions = {};
const usedKeys = new Set();
for (const [nodeId, entry] of Object.entries(regions)) {
  const slim = {};
  for (const f of REGION_FIELDS) {
    if (entry[f] != null) slim[f] = entry[f];
  }
  slimRegions[nodeId] = slim;
  for (const f of DICT_FIELDS) {
    if (typeof entry[f] === "string") usedKeys.add(entry[f]);
  }
}

const slimDict = {};
for (const key of usedKeys) {
  if (typeof dict[key] === "string") slimDict[key] = dict[key];
}

writeFileSync(path.join(outDir, "ExportRegions.json"), JSON.stringify(slimRegions));
writeFileSync(path.join(outDir, "dict.zh.json"), JSON.stringify(slimDict));

const kb = (p) => Math.round(readFileSync(p).length / 1024);
console.log(
  `Prepared warframe data in ${path.relative(repoRoot, outDir)}: ` +
    `ExportRegions.json ${kb(path.join(outDir, "ExportRegions.json"))}KB (was ${kb(srcRegions)}KB), ` +
    `dict.zh.json ${kb(path.join(outDir, "dict.zh.json"))}KB (was ${kb(srcDict)}KB)`
);
