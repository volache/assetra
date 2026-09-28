import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const functionsTarget = env.VITE_SUPABASE_URL;

  return {
    plugins: [react()],
    server: functionsTarget
      ? {
          proxy: {
            "/functions/v1": {
              target: functionsTarget,
              changeOrigin: true,
            },
          },
        }
      : undefined,
  };
});
