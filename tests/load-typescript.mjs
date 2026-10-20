import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function loadTypescript(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const resolve = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith(".")) return loadTypescript(path.resolve(path.dirname(file), `${name}.ts`), mocks, globals);
      return require(name);
  };
  // Execute in this realm: Firestore checks Promise and Timestamp identity.
  new Function("exports", "require", ...Object.keys(globals), code)(exports, resolve, ...Object.values(globals));
  return exports;
}
