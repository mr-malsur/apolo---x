
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
  higgsfieldDesignInspectorVitePlugin,
  higgsfieldDesignSourceBabelPlugin,
} from "./src/module/design-inspector/vite";
import svgr from "vite-plugin-svgr";
import { defaultServerConditions, defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const QUANTA_ICONS_SHIM = fileURLToPath(
  new URL("./src/lib/quanta-icons.ts", import.meta.url),
);

export default defineConfig(({ command, mode }) => {
  const designInspectorEnabled =
    process.env.HF_DESIGN_INSPECTOR === "1" || mode === "design";

  return {
    server: {
      watch: { usePolling: true, interval: 150 },
    },

    resolve: {
      tsconfigPaths: true,
      alias: [
        {
          find: /^@higgsfield-ai\/icons(\/.*)?$/,
          replacement: QUANTA_ICONS_SHIM,
        },
      ],
    },

    ssr: {
      ...(command === "build"
        ? {
            target: "webworker" as const,
            resolve: {
              conditions: [
                "workerd",
                "worker",
                "browser",
                ...defaultServerConditions.filter(
                  (condition) => condition !== "node",
                ),
              ],
            },
          }
        : {}),
      noExternal: command === "build" ? true : undefined,
      external: ["cloudflare:workers"],
    },

    build: {
      rollupOptions: {
        external: [/^cloudflare:/],
      },
    },

    plugins: [
      svgr({
        svgrOptions: {
          icon: true,
          svgProps: { fill: "currentColor" },
          svgoConfig: {
            plugins: [
              {
                name: "preset-default",
                params: {
                  overrides: { removeViewBox: false },
                },
              },
            ],
          },
        },
      }),

      tanstackStart({
        server: { entry: "server" },
      }),

      nitro(),

      higgsfieldDesignInspectorVitePlugin(designInspectorEnabled),

      react({
        babel: {
          plugins: designInspectorEnabled
            ? [higgsfieldDesignSourceBabelPlugin]
            : [],
        },
      }),

      tailwindcss(),
    ],
  };
});
