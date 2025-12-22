import fs from "fs";
import path from "path";

const files = ["main.js", "manifest.json", "styles.css"];
const targetDir = "test";

// 1. 删除并重建目录（保证强行覆盖）
fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

// 2. 拷贝文件（默认覆盖）
for (const file of files) {
  fs.copyFileSync(file, path.join(targetDir, file));
}

console.log("Release files copied to /test");
