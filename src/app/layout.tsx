import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";
import "./ui.css";
import "./shell.css";
import "./charts.css";
import "./pages.css";
import {Suspense} from "react";
import WorkspaceShell from "@/components/workspace-shell";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-plex-condensed",
  subsets: ["latin"],
  weight: ["500", "600"],
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
