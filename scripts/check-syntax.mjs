import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkedExtensions = new Set([".js", ".mjs", ".cjs"]);
const ignoredDirectories = new Set(["node_modules", ".git", "dist", "out"]);

function collectFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) {
      continue;
    }

    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (checkedExtensions.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = collectFiles(root);

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

console.log(`Checked ${files.length} JavaScript files.`);
