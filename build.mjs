import esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

const options = {
  entryPoints: ["./src/main.js"],
  outfile: "main.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: false,
  external: ["obsidian", "@codemirror/state", "@codemirror/view", "@codemirror/language"],
  logLevel: "info",
};

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching…");
} else {
  await esbuild.build(options);
  console.log("Built.");
}

