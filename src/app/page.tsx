"use client";

import { useState } from "react";

const navigation = ["Overview", "Sports AI", "Paper Betting", "Stock Research", "Paper Trading"] as const;
type View = (typeof navigation)[number];

const products = [
  { id: "01", name: "Sports AI", category: "ANALYSIS", description: "Game research, probability models and market comparisons.", status: "In development" },
  { id: "02", name: "Paper Betting", category: "SIMULATION", description: "Test strategies and record simulated bets without real money.", status: "Planned" },
  { id: "03", name: "Stock Research", category: "RESEARCH", description: "Company fundamentals, market context and watchlists.", status: "Planned" },
  { id: "04", name: "Paper Trading", category: "SIMULATION", description: "Build a virtual portfolio and measure your decisions.", status: "Planned" },
] as const;

export default function Home() {
  const [view, setView] = useState<View>("Overview");
  const selected = products.find((item) => item.name === view);

  return (
    <div className="min-h-screen bg-[#101512] text-[#e9e9e2] selection:bg-[#d2e4a4] selection:text-[#101512]">
      <div className="mx-auto flex min-h-screen max-w-[1680px]">
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#303b33] px-6 py-9 lg:flex">
          <button onClick={() => setView("Overview")} className="text-left text-[25px] font-semibold tracking-[-.075em] leading-none">sports<span className="text-[#c9df9a]">edge</span><span className="ml-1 align-top text-[10px] tracking-normal text-[#9da89a]">®</span></button>
          <div className="mt-3 text-[10px] uppercase tracking-[.2em] text-[#788779]">Decision intelligence</div>
          <div className="mt-16 mb-4 text-[10px] font-semibold tracking-[.18em] text-[#788779]">WORKSPACE / 01</div>
          <nav aria-label="Main navigation" className="space-y-1">
            {navigation.map((item, index) => (
              <button key={item} onClick={() => setView(item)} className={`flex w-full items-center justify-between border-l-2 px-3 py-3 text-left text-[13px] transition-colors ${view === item ? "border-[#c9df9a] bg-[#202a21] text-[#e9e9e2]" : "border-transparent text-[#9ba79b] hover:bg-[#1a241c] hover:text-white"}`}>
                <span>{item}</span><span className="font-mono text-[10px] text-[#728174]">0{index + 1}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto border-t border-[#303b33] pt-5">
            <div className="flex items-center gap-2 text-[11px] font-medium"><span className="h-1.5 w-1.5 rounded-full bg-[#c9df9a]" /> BUILD IN PROGRESS</div>
            <p className="mt-3 text-[11px] leading-5 text-[#849184]">An independent workspace for evidence-led sports and market decisions.</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#303b33] px-6 py-5 md:px-12">
            <button onClick={() => setView("Overview")} className="text-xl font-semibold tracking-[-.075em] lg:hidden">sports<span className="text-[#c9df9a]">edge</span></button>
            <div className="hidden text-[11px] uppercase tracking-[.16em] text-[#8c9a8e] lg:block">WORKSPACE <span className="mx-3 text-[#49574c]">/</span> {view}</div>
            <div className="flex items-center gap-3"><span className="h-1.5 w-1.5 rounded-full bg-[#c9df9a]" /><span className="font-mono text-[10px] tracking-[.08em] text-[#aab5a8]">PREVIEW · V0.1</span></div>
          </header>
          <div className="flex gap-2 overflow-x-auto border-b border-[#303b33] px-5 py-3 lg:hidden">
            {navigation.map((item) => <button key={item} onClick={() => setView(item)} className={`shrink-0 px-3 py-2 text-xs ${view === item ? "bg-[#c9df9a] text-[#101512]" : "text-[#a7b3a5]"}`}>{item}</button>)}
          </div>

          <div className="mx-auto max-w-[1150px] px-6 pb-20 pt-12 md:px-12 md:pt-16">
            <div className="flex flex-wrap items-start justify-between gap-8 border-b border-[#303b33] pb-12">
              <div className="max-w-[720px]">
                <div className="mb-7 font-mono text-[11px] tracking-[.16em] text-[#c9df9a]">01 / {view.toUpperCase()}</div>
                <h1 className="text-[clamp(3rem,6.8vw,6rem)] font-medium leading-[.99] tracking-[-.075em]">{view === "Overview" ? <>Make better<br/><span className="text-[#a5b3a1]">decisions.</span></> : selected?.name}</h1>
                <p className="mt-8 max-w-xl text-[15px] leading-7 text-[#a5b2a5]">{view === "Overview" ? "Research the numbers. Challenge your assumptions. Test strategies without putting capital at risk." : selected?.description}</p>
              </div>
              <div className="flex h-[76px] w-[76px] items-center justify-center rounded-full border border-[#55674e] text-[#c9df9a]"><span className="text-3xl">↗</span></div>
            </div>

            <div className="grid gap-8 border-b border-[#303b33] py-8 md:grid-cols-3">
              <div><div className="font-mono text-[10px] tracking-[.12em] text-[#829183]">DATA CONNECTIONS</div><div className="mt-3 text-2xl font-medium tracking-tight">Not connected</div></div>
              <div><div className="font-mono text-[10px] tracking-[.12em] text-[#829183]">AI MODELS</div><div className="mt-3 text-2xl font-medium tracking-tight">Not configured</div></div>
              <div><div className="font-mono text-[10px] tracking-[.12em] text-[#829183]">ENVIRONMENT</div><div className="mt-3 text-2xl font-medium tracking-tight">Development</div></div>
            </div>

            <div className="mb-6 mt-14 flex items-baseline justify-between gap-4"><h2 className="text-[22px] font-medium tracking-[-.04em]">{view === "Overview" ? "The platform" : "Module details"}</h2><span className="font-mono text-[10px] text-[#829183]">{view === "Overview" ? "FOUR DISCIPLINES" : "EARLY ACCESS"}</span></div>
            <div className="border-t border-[#303b33]">
              {(selected ? [selected] : products).map((item) => (
                <button key={item.id} onClick={() => setView(item.name)} className="group grid w-full gap-3 border-b border-[#303b33] py-7 text-left transition-colors hover:bg-[#1a231b] sm:grid-cols-[45px_1fr_1.3fr_30px] sm:items-center sm:gap-6 sm:px-3">
                  <span className="font-mono text-[11px] text-[#8b9a8c]">{item.id}</span>
                  <div><div className="text-[21px] font-medium tracking-[-.04em] group-hover:text-[#c9df9a]">{item.name}</div><div className="mt-1 font-mono text-[10px] tracking-[.1em] text-[#829183]">{item.category} · {item.status}</div></div>
                  <p className="max-w-[350px] text-[13px] leading-6 text-[#a3afa2]">{item.description}</p>
                  <span className="hidden text-xl text-[#c9df9a] transition-transform group-hover:translate-x-1 sm:block">↗</span>
                </button>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap items-start justify-between gap-5 border-l-2 border-[#c9df9a] bg-[#1b261d] px-6 py-5">
              <div><div className="text-[12px] font-semibold">Built for evidence, not hype.</div><p className="mt-2 max-w-[650px] text-[12px] leading-6 text-[#9fae9f]">This is an interface preview. Live feeds, probability models, authentication and virtual accounts are not active yet. No figures or predictions are being fabricated.</p></div>
              <span className="font-mono text-[10px] text-[#c9df9a]">ROADMAP / PHASE 01</span>
            </div>
            <footer className="mt-16 flex flex-wrap justify-between gap-3 border-t border-[#303b33] pt-5 font-mono text-[10px] tracking-[.08em] text-[#778678]"><span>SPORTSEDGE © 2026</span><span>RESEARCH FIRST. RISK AWARE.</span></footer>
          </div>
        </main>
      </div>
    </div>
  );
}
