import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "functions/lib/**", "reports/**", "node_modules/**"]),
  {
    rules: {
      /*
       * The application is published as a static export with
       * `images.unoptimized`, so `next/image` renders a plain
       * <img> and adds no optimisation. Images here are brand
       * assets, Cloudinary URLs and captured signatures, all
       * of which are sized by CSS.
       */
      "@next/next/no-img-element": "off",
    },
  },
]);
