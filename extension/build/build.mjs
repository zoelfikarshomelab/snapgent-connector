// SPDX-License-Identifier: GPL-3.0-or-later
// Usage: node build/build.mjs [chrome|firefox|all]   ->  dist/<target>/
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, buildManifest } from "./manifest.mjs";
import { tutorialPlugin } from "./tutorial.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = (await readFile(join(root, "..", "VERSION"), "utf8")).trim(); // the one place the version is written
const base = JSON.parse(await readFile(join(root, "manifests/base.json"), "utf8"));

const arg = process.argv[2] || "all";
const targets = arg === "all" ? TARGETS : [arg];

for (const target of targets) {
  const out = join(root, "dist", target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await build({
    entryPoints: {
      content: join(root, "src/entry/content.js"),
      background: join(root, "src/entry/background.js"),
      popup: join(root, "src/entry/popup.js"),
      "ssh-prompt": join(root, "src/entry/ssh-prompt.js"),
    },
    outdir: out,
    bundle: true,
    format: "iife",
    target: ["chrome110", "firefox128"],
    legalComments: "none",
    plugins: [tutorialPlugin(root)],
    logLevel: "warning",
  });

  await cp(join(root, "static"), out, { recursive: true });

  const manifest = buildManifest(base, { target, version });
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`built dist/${target} (v${version})`);
}
