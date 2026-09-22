import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const source = path.resolve(process.argv[2] ?? "../jev-general-tactic-system");
const git = (...args) =>
  execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
if (
  git(
    "status",
    "--porcelain",
    "--",
    "packages/core/src",
    "packages/core/package.json",
    "LICENSE",
  )
)
  throw Error("Commit core source and license changes before vendoring");
const output = path.resolve("vendor/jev-core");
mkdirSync(path.join(output, "src"), { recursive: true });
const files = {};
for (const name of readdirSync(path.join(source, "packages/core/src")).sort()) {
  if (!name.endsWith(".ts")) continue;
  const text = readFileSync(
    path.join(source, "packages/core/src", name),
    "utf8",
  ).replaceAll("\r\n", "\n");
  writeFileSync(path.join(output, "src", name), text);
  files[name] = createHash("sha256").update(text).digest("hex");
}
const license = readFileSync(path.join(source, "LICENSE"), "utf8").replaceAll(
  "\r\n",
  "\n",
);
if (license !== readFileSync("LICENSE", "utf8").replaceAll("\r\n", "\n"))
  throw Error("JEV and Tavern Battle must use the same license");
writeFileSync(path.join(output, "LICENSE"), license);
writeFileSync(
  path.join(output, "source.json"),
  JSON.stringify(
    {
      repository: "https://github.com/smokycamera/jev-general-tactic-system",
      commit: git("rev-parse", "HEAD"),
      version: JSON.parse(
        readFileSync(path.join(source, "packages/core/package.json"), "utf8"),
      ).version,
      license: "Tavern Battle Noncommercial License 1.0",
      licenseSha256: createHash("sha256").update(license).digest("hex"),
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Vendored ${Object.keys(files).length} core files from ${git("rev-parse", "--short", "HEAD")}`,
);
