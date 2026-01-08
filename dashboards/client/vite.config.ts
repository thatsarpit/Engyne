import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: "127.0.0.1",
    },
    define: {
      __APP_VERSION__: JSON.stringify(env.npm_package_version ?? "0.0.0"),
    },
  };
});

