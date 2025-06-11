import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  const entry = process.env.ENTRY || "team";

  return {
    build: {
      lib: {
        entry: `src/${entry}.ts`,
        formats: ["es"],
        fileName: () => `${entry}.mjs`,
      },
      rollupOptions: {
        external: ["node-fetch", "dotenv"],
        output: {
          dir: "dist",
        },
      },
      target: "node18",
      minify: false,
      emptyOutDir: false,
    },
  };
});
