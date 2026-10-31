// Commit the bundle so file:// and offline use need neither npm nor modules.
const { buildSync } = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");
buildSync({
  entryPoints: [path.join(__dirname, "../player-view.js")],
  outfile: path.join(__dirname, "../player-view.bundle.js"),
  bundle: true,
  format: "iife",
  target: ["es2020"],
  minify: true,
  legalComments: "eof",
});
fs.copyFileSync(
  path.join(__dirname, "../node_modules/three/LICENSE"),
  path.join(__dirname, "../THREE-LICENSE.txt"),
);
