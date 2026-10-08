"use client";

import { useState } from "react";

const sections = [
  { name: "Overview", icon: "◫" },
  { name: "Sports AI", icon: "◈" },
  { name: "Paper Betting", icon: "◎" },
  { name: "Stock Research", icon: "▥" },
  { name: "Paper Trading", icon: "↗" },
] as const;
type Section = (typeof sections)[number]["name"];

const modules = [
  { title: "Sports AI", eyebrow: "RESEARCH ENGINE", description: "Evaluate games, model probabilities, and compare odds.", icon: "◈", accent: "text-cyan-300", section: "Sports AI" as Section },
  { title: "Paper Betting", eyebrow: "VIRTUAL SPORTSBOOK", description: "Practice betting strategies with a simulated bankroll.", icon: "◎", accent: "text-violet-300", section: "Paper Betting" as Section },
  { title: "Stock Research", eyebrow: "MARKET INTELLIGENCE", description: "Study companies, price trends, and financial data.", icon: "▥", accent: "text-amber-300", section: "Stock Research" as Section },
  { title: "Paper Trading", eyebrow: "SIMULATED PORTFOLIO", description: "Build and track a portfolio without risking real funds.", icon: "↗", accent: "text-emerald-300", section: "Paper Trading" as Section },
];

export default function Home() {
  const [active, setActive] = useState<Section>("Overview");
  const selected = modules.find((module) => module.section === active);

  return (
    <div className="min-h-screen bg-[#080d17] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1800px]">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-[#0b1220] px-5 py-7 md:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 font-black text-slate-950">S</div>
            <div><div className="text-lg font-extrabold tracking-tight">Sports<span className="text-cyan-400">Edge</span></div><div className="text-[10px] font-semibold tracking-[.22em] text-slate-500">INTELLIGENCE PLATFORM</div></div>
          </div>
          <div className="mt-12 px-3 text-[10px] font-bold tracking-[.22em] text-slate-500">WORKSPACE</div>
          <nav className="mt-4 space-y-2" aria-label="Main navigation">
            {sections.map((item) => (
              <button key={item.name} onClick={() => setActive(item.name)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${active === item.name ? "bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
                <span className="w-5 text-center text-xl">{item.icon}</span>{item.name}
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-2xl border border-white/10 bg-white/[.03] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200"><span className="h-2 w-2 rounded-full bg-amber-400" /> Development mode</div>
            <p className="text-xs leading-5 text-slate-400">Your workspace is being built. Live data and trading features are not connected yet.</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-9">
            <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400 font-black text-slate-950 md:hidden">S</div><span className="text-sm text-slate-400">Workspace <span className="px-2 text-slate-600">/</span> <span className="font-medium text-slate-100">{active}</span></span></div>
            <div className="flex items-center gap-3"><span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200">● Preview environment</span><div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-slate-800 text-xs font-bold">SE</div></div>
          </header>

          <div className="border-b border-white/10 px-5 py-3 md:hidden">
            <div className="flex gap-2 overflow-x-auto pb-1">{sections.map((item) => <button key={item.name} onClick={() => setActive(item.name)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${active === item.name ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-300"}`}>{item.name}</button>)}</div>
          </div>

          <div className="mx-auto max-w-6xl px-5 py-9 sm:px-9 sm:py-12">
            <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
              <div><div className="mb-3 text-xs font-bold tracking-[.2em] text-cyan-400">SPORTSEDGE / PLATFORM</div><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{active === "Overview" ? "Your intelligence hub" : active}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">{active === "Overview" ? "One workspace for sports analytics, market research, and risk-free strategy testing." : selected?.description}</p></div>
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">Version 0.1 · UI preview</span>
            </div>

            <div className="mb-8 grid gap-4 sm:grid-cols-3">
              {[{label:"CONNECTED DATA FEEDS",value:"0",note:"Awaiting integrations"},{label:"ACTIVE AI MODELS",value:"0",note:"Modular backend planned"},{label:"SIMULATED ACCOUNTS",value:"0",note:"Not configured yet"}].map((metric) => <div key={metric.label} className="rounded-2xl border border-white/10 bg-[#101a2b] p-5"><div className="text-[11px] font-bold tracking-[.14em] text-slate-500">{metric.label}</div><div className="mt-3 text-3xl font-bold">{metric.value}</div><div className="mt-2 text-xs text-slate-400">{metric.note}</div></div>)}
            </div>

            <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">{active === "Overview" ? "Explore your workspace" : "Module overview"}</h2><span className="text-xs text-slate-500">4 core modules</span></div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(selected ? [selected] : modules).map((module) => <button key={module.title} onClick={() => setActive(module.section)} className="group rounded-2xl border border-white/10 bg-[#101a2b] p-6 text-left transition hover:-translate-y-0.5 hover:border-cyan-400/40 hover:bg-[#142137]">
                <div className="mb-8 flex items-start justify-between"><div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-3xl ${module.accent}`}>{module.icon}</div><span className="text-lg text-slate-500 transition group-hover:text-cyan-300">↗</span></div>
                <div className="text-[10px] font-bold tracking-[.2em] text-slate-500">{module.eyebrow}</div><h3 className="mt-2 text-xl font-bold">{module.title}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-slate-400">{module.description}</p><div className="mt-6 border-t border-white/10 pt-4 text-xs font-semibold text-cyan-300">Explore module →</div>
              </button>)}
            </div>

            <div className="mt-8 flex flex-wrap items-start gap-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/[.05] p-5"><span className="text-xl text-cyan-300">ⓘ</span><div className="flex-1"><h3 className="text-sm font-semibold text-cyan-100">Building the foundation</h3><p className="mt-1 text-sm leading-6 text-slate-400">This is a working navigation and dashboard preview, not a live prediction or trading system. Real data sources, authentication, simulation engines, and AI providers will be integrated in later development stages.</p></div></div>
          </div>
        </main>
      </div>
    </div>
  );
}
