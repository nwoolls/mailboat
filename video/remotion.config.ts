// Remotion's settings for the clips in video/ (see video/README.md).
// The clips import the app's own components and stylesheet, so the CSS goes
// through the app's Tailwind (the version in the root package.json), which
// scans the whole repository for class names, src/ included.
import path from "node:path";
import { Config } from "@remotion/cli/config";

const repo = path.resolve(process.cwd(), "..");

Config.setVideoImageFormat("png");
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setCrf(16);
Config.setColorSpace("bt709");
Config.overrideWebpackConfig((config) => ({
  ...config,
  module: {
    ...config.module,
    rules: (config.module?.rules ?? []).map((rule) => {
      if (!rule || typeof rule !== "object" || !(rule.test instanceof RegExp)) return rule;
      if (!rule.test.test("x.css")) return rule;
      const use = Array.isArray(rule.use) ? rule.use : [];
      // The last loader runs first: Tailwind, then css-loader and style-loader.
      return Object.assign({}, rule, {
        use: [...use, { loader: "@tailwindcss/webpack", options: { base: repo } }],
      });
    }),
  },
}));
