import esbuild from "esbuild";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync(".test-dist", { recursive: true });
await esbuild.build({
  entryPoints: ["tests/formatters.test.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: ".test-dist/formatters.test.cjs",
  external: ["jsdom"],
  sourcemap: "inline",
  logLevel: "warning",
});

const child = spawn(process.execPath, ["--test", ".test-dist/formatters.test.cjs"], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
