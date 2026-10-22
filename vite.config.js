import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { __DEPLOYMENT_ENV__: JSON.stringify(process.env.VERCEL_ENV || 'local') },
});
