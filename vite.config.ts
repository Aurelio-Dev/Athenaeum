import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  test: {
    exclude: [...configDefaults.exclude, "Athenaeum/**"],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**", "**/target/**"],
    },
  },
});
