// Assembles the two paste-into-Qualtrics scripts from core + hooks.
// Run: node scripts/exp2a-build.js   (from repo root or scripts/)
const fs = require("fs");
const path = require("path");
const HERE = __dirname;
const HEADER = "/* GENERATED FILE — do not edit. Edit exp2a-core.js / exp2a-hooks/* and re-run: node scripts/exp2a-build.js */\n";

const core = fs.readFileSync(path.join(HERE, "exp2a-core.js"), "utf8");
for (const [hook, out] of [["parse-hook.js", "exp2a-parse.js"], ["render-hook.js", "exp2a-render.js"]]) {
  const hookSrc = fs.readFileSync(path.join(HERE, "exp2a-hooks", hook), "utf8");
  const bundle = HEADER + core + "\n" + hookSrc;
  // Qualtrics-dialect lint: these constructs break old JFE evaluators
  for (const bad of ["?.", "??", "async ", "await "]) {
    if (bundle.includes(bad)) {
      console.error(`DIALECT VIOLATION: generated ${out} contains "${bad}"`);
      process.exit(1);
    }
  }
  fs.writeFileSync(path.join(HERE, out), bundle);
  console.log(`wrote scripts/${out} (${bundle.length} bytes)`);
}
