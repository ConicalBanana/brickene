import { defineConfig } from "vitepress";
import { withPwa } from "@vite-pwa/vitepress";

// https://vitepress.dev/reference/site-config
export default withPwa(
  defineConfig({
    title: "brickene",
    description: "brickene – A flow-graph based visual builder for block-assembled organic molecules.",
    themeConfig: {
      // https://vitepress.dev/reference/default-theme-config
      logo: "/logo.png",
      nav: [
        { text: "Home", link: "/" },
        { text: "Guide", link: "/guide/" },
        { text: "API", link: "/api/" },
        {
          text: "GitHub",
          link: "https://github.com/ConicalBanana/brickene",
        },
      ],
      sidebar: [
        {
          text: "Introduction",
          items: [
            { text: "Getting Started", link: "/guide/" },
            { text: "Installation", link: "/guide/installation" },
          ],
        },
        {
          text: "API Reference",
          items: [
            { text: "Overview", link: "/api/" },
            { text: "Examples", link: "/api/examples" },
          ],
        },
      ],
      socialLinks: [
        {
          icon: "github",
          link: "https://github.com/ConicalBanana/brickene",
        },
      ],
      footer: {
        message: "Released under the MIT License.",
        copyright:
          'Copyright © 2026 none',
      },
    },
    pwa: {
      manifest: {
        name: "brickene",
        short_name: "brickene",
        theme_color: "#2b2a27",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/logo.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable any",
          },
        ],
      },
    },
  })
);
