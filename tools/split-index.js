// tools/split-index.js
// VMS NextGen foundation refactor helper.
//
// Purpose:
//   Split the monolithic index.html into external CSS and JS files without
//   changing the CSS or JavaScript contents.
//
// Usage from repository root:
//   node tools/split-index.js
//
// Output:
//   index.html
//   assets/css/main.css
//   assets/js/app.js

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const indexPath = path.join(root, "index.html");
const cssDir = path.join(root, "assets", "css");
const jsDir = path.join(root, "assets", "js");
const cssPath = path.join(cssDir, "main.css");
const jsPath = path.join(jsDir, "app.js");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(indexPath)) {
  fail("index.html was not found in the repository root.");
}

const original = fs.readFileSync(indexPath, "utf8");

const styleMatch = original.match(/  <style>\r?\n([\s\S]*?)\r?\n  <\/style>/);
if (!styleMatch) {
  fail("Could not find the expected inline <style> block.");
}

const scriptMatches = [...original.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scriptMatches.length !== 1) {
  fail(`Expected exactly one inline <script> block, found ${scriptMatches.length}.`);
}

const css = styleMatch[1].replace(/^    /gm, "") + "\n";
const js = scriptMatches[0][1].replace(/^\r?\n/, "").replace(/\r?\n$/, "") + "\n";

const updatedIndex = original
  .replace(styleMatch[0], '  <link rel="stylesheet" href="assets/css/main.css" />')
  .replace(scriptMatches[0][0], '<script src="assets/js/app.js"></script>');

fs.mkdirSync(cssDir, { recursive: true });
fs.mkdirSync(jsDir, { recursive: true });

fs.writeFileSync(cssPath, css, "utf8");
fs.writeFileSync(jsPath, js, "utf8");
fs.writeFileSync(indexPath, updatedIndex, "utf8");

console.log("VMS NextGen split completed.");
console.log("Created/updated:");
console.log("- assets/css/main.css");
console.log("- assets/js/app.js");
console.log("- index.html");
