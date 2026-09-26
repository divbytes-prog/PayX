import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  defaultGateways,
  simulatePayment,
  type Gateway,
  type Transaction,
} from "./payxEngine";
import { api, PayXApiError, type ConnectedGateway, type Mode, type PublicCheckout, type Session } from "./api";
import { openCheckout } from "./checkout";

type View = "overview" | "dashboard" | "gateways" | "keys" | "docs" | "pay";
const viewFromHash = (): View => {
  const route = window.location.hash.slice(1);
  if (route === "pay" && new URLSearchParams(window.location.search).has("checkout")) return "pay";
  return route === "sandbox" || route === "dashboard" ? "dashboard"
    : route === "gateways" || route === "keys" || route === "docs" ? route : "overview";
};

const seed: Transaction[] = [
  {
    id: "px_8b13f9d201",
    createdAt: new Date(Date.now() - 420000).toISOString(),
    amount: 12800,
    currency: "INR",
    gateway: "Paytm",
    status: "simulated",
    idempotencyKey: "order_10241",
    gatewayTransactionId: "paytm_81fd208e",
    routedBy: "balanced",
  },
  {
    id: "px_1a7e40c912",
    createdAt: new Date(Date.now() - 1320000).toISOString(),
    amount: 3499,
    currency: "INR",
    gateway: "Razorpay",
    status: "simulated",
    idempotencyKey: "order_10240",
    gatewayTransactionId: "razorpay_21da0de2",
    routedBy: "lowest_fee",
  },
  {
    id: "px_4c9e2049ca",
    createdAt: new Date(Date.now() - 2640000).toISOString(),
    amount: 79,
    currency: "USD",
    gateway: "Stripe",
    status: "simulated",
    idempotencyKey: "sub_8812",
    gatewayTransactionId: "stripe_9c7d0bb1",
    routedBy: "balanced",
  },
];

const money = (v: number, c: string) => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: c,
      maximumFractionDigits: c === "INR" ? 0 : 2,
    }).format(v);
  } catch {
    return `${v} ${c}`;
  }
};

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [backendReady, setBackendReady] = useState(false);
  const [stripeOAuthReady, setStripeOAuthReady] = useState(false);
  const [stripeLiveOAuthReady, setStripeLiveOAuthReady] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [mode, setMode] = useState<Mode>("test");
  const go = (next: View) => {
    window.location.hash = next === "dashboard" ? "sandbox" : next;
    setView(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const sync = () => setView(viewFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const [gateways, setGateways] = useState<Gateway[]>(() =>
    loadLocal("payx_gateways", defaultGateways),
  );
  const [tx, setTx] = useState<Transaction[]>(() => {
    const saved = loadLocal("payx_transactions", seed);
    const demoIds = new Set(seed.map((item) => item.id));
    return saved.map((item) => demoIds.has(item.id) ? { ...item, status: "simulated" } : item);
  });
  const [toast, setToast] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [connectedGateways, setConnectedGateways] = useState<
    ConnectedGateway[]
  >([]);
  const [authChecked, setAuthChecked] = useState(false);
  useEffect(
    () => localStorage.setItem("payx_gateways", JSON.stringify(gateways)),
    [gateways],
  );
  useEffect(() => {
    if (!session) localStorage.setItem("payx_transactions", JSON.stringify(tx));
  }, [tx, session]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    api.health().then(async (health) => {
      setStripeOAuthReady(health.stripeOAuth);
      setStripeLiveOAuthReady(health.stripeLiveOAuth);
      setLiveEnabled(health.liveEnabled);
      if (health.database !== "configured") return;
      setBackendReady(true);
      await api.me().then((active) => { setTx([]); setSession(active); }).catch(() => {});
    }).catch(() => {}).finally(() => setAuthChecked(true));
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gateway") === "stripe" && params.get("connected") === "true") {
      go("gateways");
      setToast("Stripe account connected");
      window.history.replaceState(null, "", `${window.location.pathname}#gateways`);
    } else if (params.get("gateway") === "stripe" && params.get("error")) {
      go("gateways");
      setToast(params.get("error") || "Stripe connection failed");
      window.history.replaceState(null, "", `${window.location.pathname}#gateways`);
    } else if (params.get("payment")) {
      if (params.get("mode") === "live") setMode("live");
      go("dashboard");
      setToast("Checkout returned. Check the verified status in your ledger.");
      window.history.replaceState(null, "", `${window.location.pathname}#sandbox`);
    }
  }, []);
  const refreshCloud = useCallback(async () => {
    if (!session) return;
    const [transactions, connections] = await Promise.all([
      api.transactions(mode),
      api.gateways(),
    ]);
    setTx(transactions);
    setConnectedGateways(connections);
  }, [session, mode]);
  useEffect(() => {
    if (session)
      refreshCloud().catch((e) =>
        setToast(e instanceof Error ? e.message : "Backend unavailable"),
      );
  }, [session, refreshCloud]);
  const signedIn = (next: Session) => {
    setTx([]);
    setSession(next);
    setAuthOpen(false);
    setToast(`Welcome, ${next.user.name}`);
  };
  const signOut = async () => {
    await api.logout();
    setSession(null);
    setConnectedGateways([]);
    setMode("test");
    setTx(seed);
    setToast("Signed out");
  };

  if (view === "pay") return <div className="app">
    <header className="nav"><a className="brand" href="/"><span>PX</span> PayX</a></header>
    <CustomerCheckout token={new URLSearchParams(window.location.search).get("checkout") ?? ""} />
    <footer><small>Provider checkout · verified payment status</small></footer>
  </div>;

  return (
    <div className="app">
      <header className="nav">
        <button className="brand" onClick={() => go("overview")}>
          <span>PX</span> PayX
        </button>
        <div className="navlinks">
          {(["overview", "dashboard", "gateways", ...(session ? ["keys" as View] : []), "docs"] as View[]).map(
            (v) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => go(v)}
              >
                {v === "docs" ? "API Docs" : v === "keys" ? "API Keys" : v[0].toUpperCase() + v.slice(1)}
              </button>
            ),
          )}
        </div>
        <div className="navActions">
          <button className="cta" onClick={() => go("dashboard")}>
            {session ? "Open dashboard" : "Open sandbox"}
          </button>
          {authChecked &&
            (session ? (
              <button className="account" onClick={signOut} title="Sign out">
                {session.user.name.split(" ")[0]} · Sign out
              </button>
            ) : (
              <button className="account" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            ))}
        </div>
      </header>

      {view === "overview" && <Overview gateways={gateways} go={go} />}
      {view === "dashboard" && (
        <Dashboard
          gateways={gateways}
          tx={tx}
          setTx={setTx}
          notify={setToast}
          session={session}
          onAuth={() => setAuthOpen(true)}
          backendReady={backendReady}
          mode={mode}
          setMode={setMode}
          liveEnabled={liveEnabled && (session?.role === "owner" || session?.role === "admin")}
          connected={connectedGateways}
        />
      )}
      {view === "gateways" && (
        <GatewayPage
          gateways={gateways}
          setGateways={setGateways}
          notify={setToast}
          session={session}
          connected={connectedGateways}
          onAuth={() => setAuthOpen(true)}
          onRefresh={refreshCloud}
          backendReady={backendReady}
          stripeOAuthReady={stripeOAuthReady}
          stripeLiveOAuthReady={stripeLiveOAuthReady}
          liveEnabled={liveEnabled}
        />
      )}
      {view === "docs" && <Docs />}
      {view === "keys" && (session ? <ApiKeys session={session} liveEnabled={liveEnabled} /> : <main className="wrap page"><h1>Sign in to manage API keys.</h1></main>)}

      <footer>
        <div>
          <b>PayX</b>
          <span>
            One API. Multiple gateways. Smarter payment infrastructure.
          </span>
        </div>
        <small>{session ? "Provider checkout · verified payment status · 2026" : "Public sandbox · simulated payments · 2026"}</small>
      </footer>
      {toast && <div className="toast">{toast}</div>}
      {authOpen && (
        <AuthModal onClose={() => setAuthOpen(false)} onSuccess={signedIn} backendReady={backendReady} />
      )}
    </div>
  );
}

function CustomerCheckout({ token }: { token: string }) {
  const [payment, setPayment] = useState<PublicCheckout | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(() => api.publicCheckout(token).then(setPayment), [token]);
  useEffect(() => {
    let active = true;
    api.publicCheckout(token).then((data) => { if (active) setPayment(data); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Payment link unavailable"); });
    const timer = window.setInterval(() => {
      api.publicCheckout(token).then((data) => { if (active) setPayment(data); }).catch(() => {});
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token]);
  const pay = async () => {
    if (!payment?.checkout) return;
    setBusy(true); setError("");
    try {
      await openCheckout(payment.checkout, token, (message) => {
        setNotice(message);
        void refresh().catch(() => {});
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open provider checkout");
    } finally { setBusy(false); }
  };
  const provider = payment?.provider === "paytm" ? "Paytm" : payment?.provider === "razorpay" ? "Razorpay" : "Stripe";
  return <main className="wrap page payerPage">
    <div className="panel payerCard">
      <p className="kicker">SECURE PROVIDER CHECKOUT</p>
      <h1>{payment ? `Pay ${payment.merchant}` : "Payment checkout"}</h1>
      {!payment && !error && <p>Loading payment details…</p>}
      {payment && <>
        <p className="payerAmount">{money(payment.amount, payment.currency)}</p>
        <p>Provider: <b>{provider}</b> · {payment.mode === "live" ? "Live payment" : "Test payment"}</p>
        <p>Reference: <code>{payment.id}</code></p>
        {payment.status === "succeeded" ? <p className="payerSuccess">Payment confirmed by {provider}.</p>
          : payment.status === "failed" ? <p className="formError">This payment failed. Ask the merchant for a fresh payment link.</p>
          : payment.checkout ? <>
            <p>{provider} will handle your payment details and any account sign-in or bank approval. On mobile, available app payment options may open in your installed app.</p>
            <button className="primary wide" disabled={busy} onClick={pay}>
              {busy ? "Opening checkout…" : `Continue to ${provider}`}
            </button>
            <small>PayX confirms the result only after verification with {provider}. This link expires {new Date(payment.expiresAt).toLocaleString()}.</small>
          </> : <p>This checkout is unavailable or has expired. Ask the merchant for a new payment link.</p>}
        {notice && <p>{notice}</p>}
      </>}
      {error && <p className="formError">{error}</p>}
    </div>
  </main>;
}

function Overview({
  gateways,
  go,
}: {
  gateways: Gateway[];
  go: (v: View) => void;
}) {
  const features = [
    [
      "01",
      "Unified payment API",
      "One merchant-facing contract regardless of the provider used underneath.",
    ],
    [
      "02",
      "Configurable routing",
      "Route by resilience, fee or latency without moving provider logic into the merchant app.",
    ],
    [
      "03",
      "Idempotency",
      "A repeated request with the same key resolves to the existing transaction.",
    ],
    [
      "04",
      "Gateway abstraction",
      "Adapters isolate provider payloads and normalize responses into one PayX format.",
    ],
    [
      "05",
      "Central ledger",
      "Track status, amount, gateway, external IDs, routing mode and timestamps in one place.",
    ],
    [
      "06",
      "Failover-ready design",
      "Unavailable providers can be removed from eligible routing paths without changing the merchant API.",
    ],
  ];
  return (
    <main>
      <section className="hero wrap">
        <div>
          <p className="kicker">PAYMENT INFRASTRUCTURE / ORCHESTRATION</p>
          <h1>
            Integrate payments <em>once.</em>
            <br />
            Orchestrate them everywhere.
          </h1>
          <p className="lead">
            PayX is a unified orchestration layer for commerce teams that need
            multiple payment gateways without multiplying integration
            complexity.
          </p>
          <div className="actions">
            <button className="primary" onClick={() => go("dashboard")}>
              Launch live sandbox
            </button>
            <button className="secondary" onClick={() => go("docs")}>
              Read API docs
            </button>
          </div>
          <div className="chips">
            <span>Unified API</span>
            <span>Multi-gateway</span>
            <span>Idempotent</span>
            <span>Failover-ready</span>
          </div>
        </div>
        <div className="terminal panel">
          <div className="terminalbar">
            <i />
            <i />
            <i />
            <small>orchestration.live</small>
          </div>
          <div className="merchantNode">Merchant application</div>
          <div className="vline" />
          <div className="payxNode">PayX</div>
          <div className="fan">↙ &nbsp;&nbsp; ↓ &nbsp;&nbsp; ↘</div>
          <div className="providers">
            {gateways.map((g) => (
              <div key={g.id} className={g.status}>
                <b>{g.name}</b>
                <small>{g.status}</small>
              </div>
            ))}
          </div>
          <div className="event">
            <span>latest route</span>
            <b>order_10241 → Paytm</b>
            <strong>219 ms</strong>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <p className="kicker">01 / THE PROBLEM</p>
        <h2>Every gateway creates another integration surface.</h2>
        <div className="painGrid">
          {[
            "Different APIs & SDKs",
            "Gateway-specific business logic",
            "Hard switching & vendor lock-in",
            "Duplicate-payment risk on retries",
            "Fragmented transaction tracking",
            "More engineering work over time",
          ].map((x, i) => (
            <article key={x}>
              <small>0{i + 1}</small>
              <h3>{x}</h3>
            </article>
          ))}
        </div>
      </section>

      <section className="paper">
        <div className="wrap split">
          <div>
            <p className="kicker dark">02 / THE PAYX LAYER</p>
            <h2>
              One contract in.
              <br />
              Many gateways out.
            </h2>
            <p>
              Merchants integrate once. PayX keeps provider-specific request
              shaping, routing decisions and normalized responses behind the
              orchestration boundary.
            </p>
          </div>
          <div className="beforeAfter">
            <div>
              <small>WITHOUT PAYX</small>
              <p>App → Stripe</p>
              <p>App → Razorpay</p>
              <p>App → Other gateway</p>
            </div>
            <strong>→</strong>
            <div>
              <small>WITH PAYX</small>
              <p>
                App → <b>PayX</b>
              </p>
              <p className="accent">→ Stripe / Razorpay / Paytm</p>
              <p>one stable merchant API</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <p className="kicker">03 / CORE CAPABILITIES</p>
        <h2>Payment infrastructure designed around developer control.</h2>
        <div className="featureGrid">
          {features.map(([n, t, b]) => (
            <article key={n}>
              <small>{n}</small>
              <h3>{t}</h3>
              <p>{b}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section wrap">
        <p className="kicker">04 / ARCHITECTURE</p>
        <h2>Modular by design.</h2>
        <div className="arch">
          {[
            "Merchant app",
            "PayX API",
            "Auth / authorization",
            "Orchestration",
            "Routing engine",
            "Gateway adapters",
            "Stripe · Razorpay · Paytm",
          ].map((x, i) => (
            <React.Fragment key={x}>
              <div className={i === 3 ? "focus" : ""}>
                <b>{x}</b>
                {i === 1 && <span>REST API</span>}
                {i === 6 && <span>external providers</span>}
              </div>
              {i < 6 && <i>→</i>}
            </React.Fragment>
          ))}
          <p>
            PayX API → PostgreSQL → transactions · users · gateway
            configurations · subscriptions
          </p>
        </div>
      </section>

      <section className="section wrap">
        <p className="kicker">05 / WHY ORCHESTRATION</p>
        <h2>Less coupling. More optionality.</h2>
        <div className="compare">
          <div>
            <b>Dimension</b>
            <b>Direct integration</b>
            <b>PayX</b>
          </div>
          {[
            ["Integrations required", "One per gateway", "One PayX API"],
            ["API consistency", "Provider-specific", "Unified"],
            [
              "Gateway switching",
              "Application changes",
              "Adapter / config change",
            ],
            ["Transaction view", "Fragmented", "Centralized"],
            ["Failover path", "Custom work", "Orchestration-ready"],
            ["Vendor lock-in", "Higher", "Reduced"],
          ].map((r) => (
            <div key={r[0]}>
              <span>{r[0]}</span>
              <span>{r[1]}</span>
              <strong>{r[2]}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="section wrap roadmap">
        <div>
          <p className="kicker">06 / ROADMAP</p>
          <h2>From orchestrator to payment control plane.</h2>
          <p>
            Roadmap items are intentionally labelled as future scope rather than
            current implementation.
          </p>
        </div>
        <div>
          {[
            [
              "Phase 1",
              "More gateways · richer routing rules · dashboard analytics",
            ],
            [
              "Phase 2",
              "Automated reconciliation · historical-performance routing · regional optimization",
            ],
            [
              "Phase 3",
              "Fraud/risk integrations · payment optimization · SDKs · marketplace capabilities",
            ],
          ].map((x) => (
            <article key={x[0]}>
              <small>{x[0]}</small>
              <p>{x[1]}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="closing">
        <div className="wrap">
          <p className="kicker dark">PAYX / PAYMENT ORCHESTRATION</p>
          <h2>
            Integrate payments once.
            <br />
            <em>Orchestrate them everywhere.</em>
          </h2>
          <button className="darkButton" onClick={() => go("dashboard")}>
            Try the sandbox
          </button>
        </div>
      </section>
    </main>
  );
}

function Dashboard({
  gateways,
  tx,
  setTx,
  notify,
  session,
  onAuth,
  backendReady,
  mode,
  setMode,
  liveEnabled,
  connected,
}: {
  gateways: Gateway[];
  tx: Transaction[];
  setTx: React.Dispatch<React.SetStateAction<Transaction[]>>;
  notify: (s: string) => void;
  session: Session | null;
  onAuth: () => void;
  backendReady: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  liveEnabled: boolean;
  connected: ConnectedGateway[];
}) {
  const [amount, setAmount] = useState(1000),
    [currency, setCurrency] = useState("INR"),
    [rule, setRule] = useState<"balanced" | "lowest_fee" | "lowest_latency">(
      "balanced",
    ),
    [key, setKey] = useState(
      "order_" + Math.floor(10000 + Math.random() * 90000),
    ),
    [last, setLast] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [preferredGateway, setPreferredGateway] = useState<"auto" | "stripe" | "razorpay" | "paytm">("auto");
  const available = connected.filter((item) => item.mode === mode && item.status === "connected");
  const canCreatePayment = !session || ["owner", "admin", "developer"].includes(session.role);
  const enabled = gateways.filter((g) => g.enabled && g.status !== "offline");
  const success = tx.length
    ? Math.round(
    (tx.filter((t) => t.status === "succeeded" || (!session && t.status === "simulated")).length / tx.length) * 100,
      )
    : 0;
  const volume = tx.reduce(
    (s, t) => s + (t.currency === "INR" ? t.amount : 0),
    0,
  );
  const run = async () => {
    if (!amount || amount < 1 || !key.trim()) {
      notify("Enter a valid amount and idempotency key");
      return;
    }
    if (!session) {
      const r = simulatePayment({
        amount,
        currency,
        idempotencyKey: key,
        gateways,
        rule,
        existing: tx,
      });
      setLast(r.transaction);
      if (!r.duplicate) setTx([r.transaction, ...tx]);
      notify(
        r.duplicate
          ? "Idempotency hit — existing transaction returned"
          : `Sandbox routed to ${r.transaction.gateway}`,
      );
      return;
    }
    if (!canCreatePayment) {
      notify("Your workspace role cannot create payments");
      return;
    }
    if (mode === "live" && !available.length) {
      notify("Connect a live gateway before creating a live payment");
      return;
    }
    if (mode === "live" && available.length > 1 && preferredGateway === "auto") {
      notify("Select the live gateway for this payment");
      return;
    }
    setBusy(true);
    try {
      const r = await api.createPayment({
        amount,
        currency,
        routingRule: rule,
        idempotencyKey: key,
        mode,
        preferredGateway: preferredGateway === "auto" ? undefined : preferredGateway,
      });
      setLast(r.transaction);
      if (!r.duplicate) setTx((current) => [r.transaction, ...current]);
      notify(r.transaction.status === "simulated"
        ? "No test gateway connected; payment simulated"
        : r.duplicate ? "Existing payment link returned" : "Customer payment link created");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Payment request failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="wrap page">
      <div className="pageHead">
        <div>
          <p className="kicker">
            {session ? `${mode.toUpperCase()} WORKSPACE` : "PUBLIC SANDBOX"}
          </p>
          <h1>Payment control room.</h1>
          <p>
            {session
              ? `Persistent workspace for ${session.organization.name}. Payments are authenticated, idempotent and audit logged.`
              : "Create simulated payments, change routing rules and see the result. No account or payment details needed."}
          </p>
        </div>
        <span className="live">
          ● {session ? "backend connected" : "browser sandbox ready"}
        </span>
      </div>
      {!session && backendReady && (
        <div className="saasNotice">
          <div>
            <b>Want persistent transactions and gateway connections?</b>
            <span>
              Sign in to use the authenticated PostgreSQL backend, API keys and
              signed webhooks.
            </span>
          </div>
          <button onClick={onAuth}>Create workspace</button>
        </div>
      )}
      {!session && !backendReady && (
        <div className="saasNotice"><div><b>Browser sandbox is ready.</b><span>Workspace sign in and provider connections will be available when the deployment database is configured.</span></div></div>
      )}
      {session && <div className="saasNotice">
        <div><b>{mode === "live" ? "Live checkout" : "Test checkout"}</b>
          <span>{mode === "live" ? "Connected live providers can collect real payments. Confirm the amount and merchant account before opening checkout." : "Provider test accounts use test funds. Without a connection, requests are marked simulated."}</span>
        </div>
        <label className="modeSelect">Mode
          <select value={mode} onChange={(event) => { setMode(event.target.value as Mode); setTx([]); setLast(null); setPreferredGateway("auto"); }}>
            <option value="test">Test</option>
            {liveEnabled && <option value="live">Live</option>}
          </select>
        </label>
      </div>}
      <div className="metrics">
        <Metric l={session ? "INR volume" : "Demo volume"} v={money(volume, "INR")} />
        <Metric l="Transactions" v={String(tx.length)} />
        <Metric l={session ? "Success rate" : "Simulation completion"} v={success + "%"} />
        <Metric l={session ? "Connected gateways" : "Eligible gateways"} v={String(session ? available.length : enabled.length)} />
      </div>
      <div className="dashGrid">
        <section className="panel form">
          <div className="panelHead">
            <div>
              <small>POST /api/payments</small>
              <h2>Create payment</h2>
            </div>
            <span>{session ? "authenticated" : "sandbox"}</span>
          </div>
          <label>
            Amount
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(+e.target.value)}
            />
          </label>
          <div className="two">
            <label>
              Currency
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option>INR</option>
                <option>USD</option>
                <option>EUR</option>
              </select>
            </label>
            <label>
              Routing
              <select
                value={rule}
                onChange={(e) => setRule(e.target.value as typeof rule)}
              >
                <option value="balanced">Balanced</option>
                <option value="lowest_fee">Lowest fee</option>
                <option value="lowest_latency">Lowest latency</option>
              </select>
            </label>
          </div>
          {session && <label>Gateway
            <select value={preferredGateway} onChange={(e) => setPreferredGateway(e.target.value as typeof preferredGateway)}>
              <option value="auto">{mode === "live" && available.length > 1 ? "Choose a live gateway" : "Automatic routing"}</option>
              {available.map((item) => <option key={item.id} value={item.provider}>{item.provider[0].toUpperCase() + item.provider.slice(1)}</option>)}
            </select>
          </label>}
          <label>
            Idempotency key
            <input value={key} onChange={(e) => setKey(e.target.value)} />
            <small>
              Retry the exact same key to verify duplicate protection.
            </small>
          </label>
          <button className="secondary newKey" onClick={() => setKey(`order_${crypto.randomUUID().slice(0, 12)}`)}>
            Generate new key
          </button>
          <button className="primary wide" onClick={run} disabled={busy || !canCreatePayment || (Boolean(session) && mode === "live" && !available.length)}>
            {busy ? "Processing…" : !canCreatePayment ? "View only" : session ? `Create ${mode} payment link` : "Create simulated payment"}
          </button>
          {last && (
            <div className={"result " + last.status}>
              <small>normalized response</small>
              <b>{last.status.toUpperCase()}</b>
              <p>
                <span>transaction</span>
                {last.id}
              </p>
              <p>
                <span>gateway</span>
                {last.gateway}
              </p>
              <p>
                <span>provider ID</span>
                {last.gatewayTransactionId}
              </p>
              {last.checkoutUrl && <div className="checkoutLink">
                <small>Customer payment link</small>
                <a href={last.checkoutUrl} target="_blank" rel="noreferrer">Open customer checkout</a>
                <button className="secondary" onClick={() => void navigator.clipboard.writeText(last.checkoutUrl ?? "").then(() => notify("Payment link copied"))}>Copy link</button>
              </div>}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panelHead">
            <div>
              <small>ORCHESTRATION</small>
              <h2>Gateway health</h2>
            </div>
          </div>
          {(session ? available.map((item) => ({ id: item.id, name: item.provider[0].toUpperCase() + item.provider.slice(1),
            status: item.status, mode: item.mode })) : gateways).map((g) => (
            <div className="health" key={g.id}>
              <div>
                <i className={g.status === "connected" ? "healthy" : g.status} />
                <b>{g.name}</b>
                <small>{session ? mode : "enabled" in g && g.enabled ? g.status : "disabled"}</small>
              </div>
              {!session && "latency" in g && <div>
                <span>{g.latency} ms</span>
                <span>{g.successRate}%</span>
                <span>{g.fee}% fee</span>
              </div>}
            </div>
          ))}
          {session && !available.length && <p className="muted">No {mode} gateway connected. Connect one from Gateways.</p>}
        </section>
      </div>
      <section className="panel ledger">
        <div className="panelHead">
          <div>
            <small>CENTRAL LEDGER</small>
            <h2>Recent transactions</h2>
          </div>
          {!session && <button
            className="secondary"
            onClick={() => {
              setTx(seed);
              setLast(null);
              notify("Sandbox reset");
            }}
          >
            Reset demo
          </button>}
        </div>
        <TransactionTable data={tx} />
      </section>
    </main>
  );
}

function Metric({ l, v }: { l: string; v: string }) {
  return (
    <div className="metric">
      <small>{l}</small>
      <b>{v}</b>
    </div>
  );
}
function TransactionTable({ data }: { data: Transaction[] }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Gateway</th>
            <th>Route</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t) => (
            <tr key={t.id}>
              <td>
                <code>{t.id}</code>
                <small>{t.idempotencyKey}</small>
                {t.checkoutUrl && <a href={t.checkoutUrl} target="_blank" rel="noreferrer">Customer checkout</a>}
              </td>
              <td>
                <span className={"status " + t.status}>{t.status}</span>
              </td>
              <td>{money(t.amount, t.currency)}</td>
              <td>{t.gateway}</td>
              <td>{t.routedBy.replace("_", " ")}</td>
              <td>
                {new Date(t.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GatewayPage({
  gateways,
  setGateways,
  notify,
  session,
  connected,
  onAuth,
  onRefresh,
  backendReady,
  stripeOAuthReady,
  stripeLiveOAuthReady,
  liveEnabled,
}: {
  gateways: Gateway[];
  setGateways: (g: Gateway[]) => void;
  notify: (s: string) => void;
  session: Session | null;
  connected: ConnectedGateway[];
  onAuth: () => void;
  onRefresh: () => Promise<void>;
  backendReady: boolean;
  stripeOAuthReady: boolean;
  stripeLiveOAuthReady: boolean;
  liveEnabled: boolean;
}) {
  const update = (id: string, p: Partial<Gateway>) =>
    setGateways(gateways.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const [configure, setConfigure] = useState<{ provider: "razorpay" | "paytm"; mode: Mode } | null>(null);
  const isConnected = (provider: string, mode: Mode = "test") =>
    connected.some(
      (item) => item.provider === provider && item.mode === mode && item.status === "connected",
    );
  return (
    <main className="wrap page">
      <div className="pageHead">
        <div>
          <p className="kicker">GATEWAY CONTROL</p>
          <h1>Provider configuration.</h1>
          <p>
            {session
              ? "Connect merchant test or live accounts. Credentials are AES-256-GCM encrypted before storage and never returned to the browser."
              : "Enable, disable and simulate health without changing the merchant-facing contract."}
          </p>
        </div>
      </div>
      {!session && backendReady && (
        <div className="saasNotice">
          <div>
            <b>Gateway credentials require an authenticated workspace.</b>
            <span>
              The public sandbox never asks for or stores payment secrets.
            </span>
          </div>
          <button onClick={onAuth}>Sign in to connect</button>
        </div>
      )}
      {!session && !backendReady && (
        <div className="saasNotice"><div><b>Gateway connection requires a configured workspace.</b><span>You can still change gateway health in the browser sandbox.</span></div></div>
      )}
      <div className="gatewayCards">
        {gateways.map((g) => (
          <article className="panel" key={g.id}>
            <div className="gatewayTitle">
              <div>
                <i className={g.status} />
                <h2>{g.name}</h2>
              </div>
              {!session && <label className="switch">
                <input
                  type="checkbox"
                  checked={g.enabled}
                  onChange={(e) => {
                    update(g.id, { enabled: e.target.checked });
                    notify(
                      `${g.name} ${e.target.checked ? "enabled" : "disabled"}`,
                    );
                  }}
                />
                <span />
              </label>}
            </div>
            {!session && <div className="gstats">
              <div>
                <small>success rate</small>
                <b>{g.successRate}%</b>
              </div>
              <div>
                <small>latency</small>
                <b>{g.latency}ms</b>
              </div>
              <div>
                <small>fee</small>
                <b>{g.fee}%</b>
              </div>
            </div>}
            {!session && <label>
              Health
              <select
                value={g.status}
                onChange={(e) =>
                  update(g.id, { status: e.target.value as Gateway["status"] })
                }
              >
                <option value="healthy">Healthy</option>
                <option value="degraded">Degraded</option>
                <option value="offline">Offline</option>
              </select>
            </label>}
            <div className="secret">
              <small>
                {session ? `Test: ${isConnected(g.id) ? "connected" : "not connected"} · Live: ${isConnected(g.id, "live") ? "connected" : "not connected"}` : "Browser simulation"}
              </small>
              <code>
                {isConnected(g.id)
                  ? "encrypted credentials"
                  : session ? "Add provider credentials" : "No provider account used"}
              </code>
              <span>
                {session ? "Connection means credentials were saved. Confirm payment status in the provider dashboard and PayX ledger." : "These controls affect the public demo only."}
              </span>
            </div>
            {session && <div className="connectionActions">
              {g.id === "stripe" ? <>
                {stripeOAuthReady ? <a className="gatewayConnect" href="/api/oauth/stripe?mode=test">
                  {isConnected("stripe") ? "Reconnect Stripe test" : "Connect Stripe test OAuth"}
                </a> : <p className="muted">Stripe test OAuth needs platform credentials.</p>}
                {liveEnabled && (stripeLiveOAuthReady ? <a className="gatewayConnect" href="/api/oauth/stripe?mode=live">
                  {isConnected("stripe", "live") ? "Reconnect Stripe live" : "Connect Stripe live OAuth"}
                </a> : <p className="muted">Stripe live OAuth needs live keys and webhook setup.</p>)}
              </> : <>
                <button className="gatewayConnect" onClick={() => setConfigure({provider: g.id as "razorpay" | "paytm", mode: "test"})}>
                  {isConnected(g.id) ? `Update ${g.name} test` : `Connect ${g.name} test`}
                </button>
                {liveEnabled && <button className="gatewayConnect" onClick={() => setConfigure({provider: g.id as "razorpay" | "paytm", mode: "live"})}>
                  {isConnected(g.id, "live") ? `Update ${g.name} live` : `Connect ${g.name} live`}
                </button>}
              </>}
              {connected.filter((item) => item.provider === g.id && item.provider === "razorpay").map((item) =>
                <small key={item.id}>Webhook ({item.mode}): <code>{`${window.location.origin}/api/webhooks/razorpay?connection=${item.id}`}</code></small>)}
            </div>}
          </article>
        ))}
      </div>
      {configure && (
        <GatewayCredentialForm
          provider={configure.provider}
          mode={configure.mode}
          onClose={() => setConfigure(null)}
          onConnected={async () => {
            setConfigure(null);
            await onRefresh();
            notify(`${configure.provider === "paytm" ? "Paytm" : "Razorpay"} ${configure.mode} connected`);
          }}
        />
      )}
      <section className="panel adapter">
        <p className="kicker">ADAPTER CONTRACT</p>
        <h2>
          Merchant requests stay stable while provider implementations change
          independently.
        </h2>
        <pre>{`interface GatewayAdapter {
  createPayment(input): Promise<GatewayResult>
  getPayment(id): Promise<GatewayResult>
  normalizeError(error): PayXError
}`}</pre>
      </section>
    </main>
  );
}

function GatewayCredentialForm({
  provider,
  mode,
  onClose,
  onConnected,
}: {
  provider: "razorpay" | "paytm";
  mode: Mode;
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    mode,
    website: mode === "live" ? "DEFAULT" : "WEBSTAGING",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field =
    (name: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.connectGateway({ provider, ...values });
      await onConnected();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not connect gateway",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modalBackdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="authModal gatewayModal"
        role="dialog"
        aria-modal="true"
        aria-label={`Connect ${provider}`}
      >
        <button
          className="modalClose"
          onClick={onClose}
          aria-label="Close gateway connection dialog"
        >
          ×
        </button>
        <p className="kicker">SECURE CONNECTION</p>
        <h2>Connect {provider === "paytm" ? "Paytm" : "Razorpay"} {mode}</h2>
        <p>
          {mode === "live" ? "Live credentials can receive real payments. Verify the account and webhook first." : "Use test credentials to verify the checkout flow."} Values are encrypted on the server and
          cannot be read back from this dashboard.
        </p>
        <form onSubmit={submit}>
          {provider === "razorpay" ? (
            <>
              <label>
                Key ID
                <input
                  autoComplete="off"
                  required
                  value={values.keyId || ""}
                  onChange={field("keyId")}
                  placeholder="rzp_test_…"
                />
              </label>
              <label>
                Key secret
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={values.keySecret || ""}
                  onChange={field("keySecret")}
                />
              </label>
              <label>
                Webhook secret {mode === "live" ? "(required)" : "(recommended)"}
                <input type="password" autoComplete="new-password" required={mode === "live"}
                  value={values.webhookSecret || ""} onChange={field("webhookSecret")} />
              </label>
            </>
          ) : (
            <>
              <label>
                Merchant ID
                <input
                  autoComplete="off"
                  required
                  value={values.merchantId || ""}
                  onChange={field("merchantId")}
                />
              </label>
              <label>
                Merchant key
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={values.merchantKey || ""}
                  onChange={field("merchantKey")}
                />
              </label>
              <label>
                Website
                <input
                  required
                  value={values.website || ""}
                  onChange={field("website")}
                />
              </label>
            </>
          )}
          {error && <p className="formError">{error}</p>}
          <button className="primary wide" disabled={busy}>
            {busy ? "Validating…" : "Encrypt and connect"}
          </button>
        </form>
      </section>
    </div>
  );
}

function ApiKeys({ session, liveEnabled }: { session: Session; liveEnabled: boolean }) {
  const [keys, setKeys] = useState<Array<{ id: string; name: string; prefix: string; mode: Mode; created_at: string }>>([]);
  const [name, setName] = useState("Merchant integration");
  const [mode, setMode] = useState<Mode>("test");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = session.role === "owner" || session.role === "admin";
  const refresh = () => api.apiKeys().then(setKeys).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load API keys"));
  useEffect(() => { void refresh(); }, []);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setSecret("");
    try {
      const result = await api.createApiKey(name, mode);
      setSecret(result.apiKey.secret);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create API key"); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    if (!window.confirm("Revoke this API key? Requests using it will stop working.")) return;
    setError("");
    try { await api.revokeApiKey(id); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke API key"); }
  };
  return <main className="wrap page">
    <div className="pageHead"><div><p className="kicker">DEVELOPER ACCESS</p><h1>API keys.</h1>
      <p>Keys belong to {session.organization.name}. Keep each secret on your server and revoke it if exposed.</p></div></div>
    {canManage && <section className="panel form keysPanel">
      <h2>Create key</h2><form onSubmit={create}>
        <label>Key name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Mode<select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
          <option value="test">Test</option>{liveEnabled && <option value="live">Live</option>}
        </select></label>
        <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create API key"}</button>
      </form>
      {secret && <div className="result"><b>Copy this key now. It will not be shown again.</b>
        <code className="secretValue">{secret}</code>
        <button className="secondary" onClick={() => navigator.clipboard.writeText(secret)}>Copy key</button>
        <button className="secondary" onClick={() => setSecret("")}>Hide key</button>
      </div>}
    </section>}
    {error && <p className="formError">{error}</p>}
    <section className="panel ledger"><div className="panelHead"><div><small>WORKSPACE</small><h2>Active keys</h2></div></div>
      <div className="scroll"><table><thead><tr><th>Name</th><th>Prefix</th><th>Mode</th><th>Created</th><th>Action</th></tr></thead>
        <tbody>{keys.map((key) => <tr key={key.id}><td>{key.name}</td><td><code>{key.prefix}…</code></td>
          <td>{key.mode}</td><td>{new Date(key.created_at).toLocaleDateString()}</td>
          <td>{canManage && <button className="secondary" onClick={() => revoke(key.id)}>Revoke</button>}</td></tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}

function Docs() {
  const sample = `curl -X POST https://pay-x-six.vercel.app/api/payments \\\n  -H "Authorization: Bearer px_test_***" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "amount": 1000, "currency": "INR", "routingRule": "balanced", "idempotencyKey": "order_10241" }'`;
  return (
    <main className="wrap page docs">
      <div className="pageHead">
        <div>
          <p className="kicker">DEVELOPER EXPERIENCE</p>
          <h1>One payment contract.</h1>
          <p>
            The underlying provider can change. Your merchant integration does
            not.
          </p>
        </div>
      </div>
      <div className="docsGrid">
        <aside>
          <a href="#create">Create payment</a>
          <a href="#flow">Lifecycle</a>
          <a href="#response">Unified response</a>
          <a href="#security">Security</a>
          <a href="#data">Data model</a>
        </aside>
        <article>
          <section id="create">
            <small>POST</small>
            <h2>/api/payments</h2>
            <p>
              Creates a PayX transaction and returns a provider checkout action.
              Reuse the idempotency key only with identical request fields. Choose
              a connected gateway explicitly when multiple live providers exist.
              Send the returned checkoutUrl to your customer. They can pay without
              a PayX merchant account; the provider handles any sign-in. The
              checkout return alone never confirms collection.
            </p>
            <pre>{sample}</pre>
          </section>
          <section id="flow">
            <h2>Transaction lifecycle</h2>
            <ol>
              {[
                "Authenticate merchant",
                "Validate request",
                "Check idempotency",
                "Create transaction record",
                "Select gateway",
                "Transform adapter payload",
                "Call provider",
                "Normalize response",
                "Update transaction state",
                "Return stable PayX response",
              ].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </section>
          <section id="response">
            <h2>Unified response</h2>
            <pre>{`{
  "transaction": {
    "id": "px_8b13f9d201",
    "status": "requires_action",
    "amount": 1000,
    "currency": "INR",
    "gateway": "stripe",
    "gatewayTransactionId": "cs_test_example",
    "checkoutUrl": "https://pay-x-six.vercel.app/?checkout=SIGNED_TOKEN#pay",
    "checkout": { "kind": "redirect", "url": "https://checkout.stripe.com/..." }
  },
  "duplicate": false,
  "sandbox": false
}`}</pre>
          </section>
          <section id="security">
            <h2>Security & reliability</h2>
            <div className="security">
              {[
                "Session and API-key authentication",
                "Organization role authorization",
                "Database idempotency constraints",
                "AES-256-GCM credential encryption",
                "Signed provider webhooks",
                "Audit-friendly transaction records",
              ].map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <p className="muted">
              The deployed backend starts in sandbox-only mode. Live payment
              activation still requires provider approval, production
              credentials, webhook verification and a compliance review.
            </p>
          </section>
          <section id="data">
            <h2>Persistent PostgreSQL model</h2>
            <div className="entities">
              <b>users & sessions</b>
              <b>organizations & memberships</b>
              <b>gateway_connections</b>
              <b>transactions & audit_logs</b>
            </div>
            <p>
              Transactions retain internal ID, merchant, amount, currency,
              gateway, status, idempotency key, provider transaction ID and
              timestamps.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}

function AuthModal({
  onClose,
  onSuccess,
  backendReady,
}: {
  onClose: () => void;
  onSuccess: (session: Session) => void;
  backendReady: boolean;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [values, setValues] = useState({
    name: "",
    email: "",
    password: "",
    organizationName: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update =
    (name: keyof typeof values) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result =
        mode === "login"
          ? await api.login({ email: values.email, password: values.password })
          : await api.register(values);
      onSuccess(result);
    } catch (reason) {
      setError(
        reason instanceof PayXApiError
          ? reason.message
          : "Authentication failed",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modalBackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="authModal"
        role="dialog"
        aria-modal="true"
        aria-label="PayX authentication"
      >
        <button
          className="modalClose"
          onClick={onClose}
          aria-label="Close authentication dialog"
        >
          ×
        </button>
        <p className="kicker">PAYX WORKSPACE</p>
        <h2>{mode === "login" ? "Welcome back." : "Create your workspace."}</h2>
        <p>
          {!backendReady ? "Workspace accounts are currently unavailable. The browser sandbox works without an account."
            : mode === "login"
            ? "Sign in to access persistent transactions and connected gateways."
            : "Start with an isolated organization, owner role and secure session."}
        </p>
        <div className="authTabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Sign in
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError("");
            }}
          >
            Register
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <label>
                Your name
                <input
                  required
                  minLength={2}
                  autoComplete="name"
                  value={values.name}
                  onChange={update("name")}
                />
              </label>
              <label>
                Workspace name
                <input
                  required
                  minLength={2}
                  autoComplete="organization"
                  value={values.organizationName}
                  onChange={update("organizationName")}
                />
              </label>
            </>
          )}
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={values.email}
              onChange={update("email")}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={mode === "register" ? 10 : 1}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={values.password}
              onChange={update("password")}
            />
            {mode === "register" && (
              <small>
                At least 10 characters, one uppercase letter and one number.
              </small>
            )}
          </label>
          {error && <p className="formError">{error}</p>}
          <button className="primary wide" disabled={busy || !backendReady}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create workspace"}
          </button>
        </form>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
