// Imports the archived DASD production tables in data/production-documents into an API (the live one by default).
// Usage: node scripts/import-production-documents.mjs [api base URL ending in /api/v1]
// Asks for the admin token without echoing it, so the token never lands in shell history.
import { readFileSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";

const base = process.argv[2] ?? "https://ani-market-api.arecanut.workers.dev/api/v1";
const folder = new URL("../data/production-documents/", import.meta.url);

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.startsWith(prompt)) process.stdout.write(prompt); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

if (!process.stdin.isTTY) throw new Error("Run this in a terminal so it can ask for the admin token.");
const token = await askHidden("Admin token: ");
if (!token) throw new Error("No token entered.");
let failed = false;
for (const file of readdirSync(folder).filter((name) => name.endsWith(".json")).sort()) {
  try {
    const response = await fetch(`${base}/admin/supply/production/documents`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: readFileSync(new URL(file, folder), "utf8"), signal: AbortSignal.timeout(120_000),
    });
    console.log(file, response.status, await response.text());
  } catch (error) {
    // Safe to rerun: the API answers "already_imported" for a document whose content it has stored.
    failed = true;
    console.error(`${file}: FAILED: ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
