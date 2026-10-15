import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const functionsTarget = env.VITE_SUPABASE_URL;

  return {
    // GitHub Pages project sites are served below /<repository>/.
    // Other environments keep the app at the domain root.
    base: env.VITE_BASE_PATH || "/",
    plugins: [react()],
    // The export worker lazy-loads xlsx, which needs ES-module workers.
    worker: { format: "es" },
    server: {
      ...(process.env.PORT
        ? { port: Number(process.env.PORT), strictPort: true }
        : {}),
      ...(functionsTarget
        ? {
            proxy: {
              "/functions/v1": {
                target: functionsTarget,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
  };
});
