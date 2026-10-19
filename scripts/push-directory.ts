/**
 * Uploads the local directory file as the Worker's DIRECTORY secret.
 *
 *   npm run directory:push                      # uses directory.json
 *   npm run directory:push -- other-file.json
 *   npm run directory:push -- --check           # validate only, upload nothing
 *
 * The file is checked with the same rules the Worker uses, and nothing is
 * uploaded if it has mistakes. Afterwards it lists every member's email, which
 * must also be allowed by the Access policy on /login.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { directoryProblems, parseDirectory } from "../src/worker/directory";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const file = args.find((arg) => !arg.startsWith("--")) ?? "directory.json";

let json: string;
try {
  json = readFileSync(file, "utf8");
} catch {
  fail(`Can't read ${file}. Copy directory.example.json to ${file} and edit it.`);
}

const mistakes = directoryProblems(json);
if (mistakes.length > 0) {
  fail(
    `${file} has mistakes, so nothing was uploaded:\n${mistakes.map((m) => `  - ${m}`).join("\n")}`,
  );
}

const emails = parseDirectory(json).emails();
if (!checkOnly) {
  // Upload compact JSON on stdin, so it never appears in the shell history or process list.
  const upload = spawnSync("npx", ["wrangler", "secret", "put", "DIRECTORY"], {
    input: JSON.stringify(JSON.parse(json)),
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (upload.status !== 0) fail("Uploading the DIRECTORY secret failed (see above).");
}

console.log(`\n${file} is valid${checkOnly ? "" : " and uploaded"}.`);
console.log("Make sure the Access policy on /login allows these emails:");
for (const email of emails) console.log(`  ${email}`);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
