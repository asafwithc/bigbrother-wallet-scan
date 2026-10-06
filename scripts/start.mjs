// Launches Next.js with the corporate proxy CA trusted (NODE_EXTRA_CA_CERTS).
// Some networks (e.g. HVL) intercept TLS; Node needs the CA to talk to the
// Solana RPC. The cert file is included in the project root as corp-ca.pem.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const caFile = path.join(here, "..", "corp-ca.pem");

if (existsSync(caFile) && !process.env.NODE_EXTRA_CA_CERTS) {
  process.env.NODE_EXTRA_CA_CERTS = caFile;
}

const args = process.argv.slice(2); // e.g. ["dev"] or ["start"]
const child = spawn(
  process.execPath,
  [path.join(here, "..", "node_modules", "next", "dist", "bin", "next"), ...args],
  { stdio: "inherit", env: process.env, windowsHide: true }
);
child.on("exit", (code) => process.exit(code ?? 0));
