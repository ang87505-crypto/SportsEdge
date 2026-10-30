import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./ui.css";
import "./shell.css";
import "./charts.css";
import "./pages.css";
import "./motion.css";
import {Suspense} from "react";
import WorkspaceShell from "@/components/workspace-shell";

// Self-hosted IBM Plex (SIL OFL 1.1, see ./fonts/OFL-LICENSE.txt, from @fontsource 5.3.0, latin subset)
// so builds never depend on a live Google Fonts download.
const plexSans = localFont({
  variable: "--font-plex-sans",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

const plexCondensed = localFont({
  variable: "--font-plex-condensed",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  src: [
    { path: "./fonts/ibm-plex-sans-condensed-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-condensed-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "SportsEdge · Sports AI, paper betting and stock research",
  description: "Sports model research, a virtual-money betting ledger and quantitative stock research with Alpaca PAPER. No real-money execution.",
};

export const viewport: Viewport = {
  themeColor: "#070C0A",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexCondensed.variable} h-full antialiased`}
    >
      <body><Suspense fallback={<div className="boot" role="status">Opening SportsEdge…</div>}><WorkspaceShell previewFixtures={process.env.SPORTSEDGE_PREVIEW_FIXTURES==="1"}>{children}</WorkspaceShell></Suspense></body>
    </html>
  );
}
