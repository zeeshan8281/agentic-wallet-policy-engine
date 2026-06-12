import { useEngine } from "./useEngine";
import { ActivityFeed } from "./ActivityFeed";
import { PolicyVerdict } from "./PolicyVerdict";
import { SpendDashboard } from "./SpendDashboard";

const short = (a: string | null) =>
  a ? (a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a) : "—";

export default function App() {
  const engine = useEngine();

  return (
    <div className="min-h-screen flex flex-col">
      {/* header */}
      <header className="border-b border-white/5 bg-black/30 backdrop-blur px-5 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-lg">🛡️</span>
            <h1 className="text-base font-semibold text-neutral-100">
              Agentic Wallet Policy Engine
            </h1>
          </div>
          <span className="text-[11px] text-neutral-500 hidden sm:inline">
            TEE-enforced spending policies · EigenCompute
          </span>

          <div className="ml-auto flex items-center gap-4 text-[11px]">
            <Meta label="wallet" value={short(engine.address)} />
            <Meta label="policy" value={short(engine.policyHash)} />
            <span
              className={`flex items-center gap-1.5 ${
                engine.connected ? "text-emerald-300" : "text-neutral-500"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  engine.connected ? "bg-emerald-400 animate-pulse" : "bg-neutral-600"
                }`}
              />
              {engine.connected ? "live" : "offline"}
            </span>
          </div>
        </div>
      </header>

      {/* three-panel layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[20rem_1fr_22rem] gap-px bg-white/5 overflow-hidden">
        <section className="bg-[#0a0b0f] min-h-[18rem] lg:min-h-0">
          <ActivityFeed items={engine.feed} />
        </section>
        <section className="bg-[#0a0b0f] min-h-[22rem] lg:min-h-0">
          <PolicyVerdict card={engine.latestVerdict} />
        </section>
        <section className="bg-[#0a0b0f] min-h-[22rem] lg:min-h-0">
          <SpendDashboard status={engine.status} policy={engine.policy} history={engine.history} />
        </section>
      </main>

      <footer className="border-t border-white/5 px-5 py-2 text-[10px] text-neutral-600">
        Built on EigenCompute · Policy enforcement runs in a separate TEE process the model cannot
        reach.
      </footer>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="hidden md:flex items-center gap-1.5">
      <span className="text-neutral-600 uppercase tracking-wider">{label}</span>
      <span className="font-mono text-neutral-300">{value}</span>
    </span>
  );
}
