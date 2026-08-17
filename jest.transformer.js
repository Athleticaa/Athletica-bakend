const esbuild = require("esbuild");

module.exports = {
  process(content, filename) {
    const result = esbuild.transformSync(content, {
      loader: filename.endsWith(".tsx") ? "tsx" : "ts",
      format: "cjs",
      target: "es2022",
      tsconfigRaw: JSON.stringify({
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      }),
    });
    return { code: result.code, map: result.map };
  },
};