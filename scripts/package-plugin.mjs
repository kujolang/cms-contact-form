import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const archive = resolve(dist, "cms-contact-form.zip");
await mkdir(dist, { recursive: true });
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, "src", "examples", ".env.example", "Dockerfile", "kujo-plugin.json", "LICENSE", "package.json", "README.md", "SECURITY.md", "-x", "*.DS_Store"], { cwd: root, stdio: "inherit" });
process.stdout.write(`${archive}\n`);
