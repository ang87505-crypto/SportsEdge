import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./polish.css";
import {Suspense} from "react";
import WorkspaceShell from "@/components/workspace-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SportsEdge · Research & Paper Trading",
  description: "Sports research, stock watchlists and virtual trading experiments.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body><Suspense fallback={<div className="loading">Opening SportsEdge…</div>}><WorkspaceShell>{children}</WorkspaceShell></Suspense></body>
    </html>
  );
}

