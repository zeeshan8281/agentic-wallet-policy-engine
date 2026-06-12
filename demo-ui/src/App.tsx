import { useEngine } from "./useEngine";
import { ActivityFeed } from "./ActivityFeed";
import { PolicyVerdict } from "./PolicyVerdict";
import { SpendDashboard } from "./SpendDashboard";
import eigenIcon from "./assets/brand/eigen-icon.svg";

const short = (a: string | null) =>
  a ? (a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a) : "—";

export default function App() {
  const engine = useEngine();

  return (
    <div className="min-h-screen flex flex-col">
      {/* header */}
      <header className="border-b border-border bg-[#0d0d0d] px-5 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <img src={eigenIcon} alt="Eigen" className="h-5 w-5" />
            <div className="leading-none">
              <h1 className="font-heading text-[15px] font-semibold text-foreground">
                Agentic Wallet Policy Engine
              </h1>
              <p className="text-[10px] text-muted-foreground mt-1 tracking-wide uppercase">
                TEE-enforced spending policy · EigenCompute
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-4 text-[11px]">
            <Meta label="wallet" value={short(engine.address)} />
            <Meta label="policy" value={short(engine.policyHash)} />
            <span
              className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 ${
                engine.connected
                  ? "border-brand/30 text-brand-light bg-brand/[0.08]"
                  : "border-border text-muted-foreground"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  engine.connected ? "bg-brand-light animate-pulse" : "bg-neutral-600"
                }`}
              />
              {engine.connected ? "live" : "offline"}
            </span>
          </div>
        </div>
      </header>

      {/* three-panel layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[20rem_1fr_22rem] gap-px bg-border overflow-hidden">
        <section className="bg-background min-h-[18rem] lg:min-h-0">
          <ActivityFeed items={engine.feed} />
        </section>
        <section className="bg-background min-h-[22rem] lg:min-h-0">
          <PolicyVerdict card={engine.latestVerdict} />
        </section>
        <section className="bg-background min-h-[22rem] lg:min-h-0">
          <SpendDashboard status={engine.status} policy={engine.policy} history={engine.history} />
        </section>
      </main>

      <footer className="border-t border-border px-5 py-2 text-[10px] text-neutral-600">
        Policy enforcement runs in a separate TEE process the model cannot reach · Built on
        EigenCompute
      </footer>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="hidden md:flex items-center gap-1.5">
      <span className="text-neutral-600 uppercase tracking-wider">{label}</span>
      <span className="font-mono text-muted-foreground">{value}</span>
    </span>
  );
}
