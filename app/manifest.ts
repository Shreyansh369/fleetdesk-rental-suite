import type { MetadataRoute } from "next";

/*
 * Makes FleetDesk installable from the browser on Android,
 * iPhone and iPad, desktop Chrome and Edge, and TV browsers that
 * support it: it opens full screen from its own icon, with no
 * app store involved.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FleetDesk",
    short_name: "FleetDesk",
    description: "Operations software for car rental businesses",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f5f7",
    theme_color: "#121822",
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/app-icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
