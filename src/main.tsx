import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { defaultGateways, simulatePayment, type Gateway, type Transaction } from "./payxEngine";

type View = "overview" | "dashboard" | "gateways" | "docs";

const seed: Transaction[] = [
  { id:"px_8b13f9d201", createdAt:new Date(Date.now()-420000).toISOString(), amount:12800, currency:"INR", gateway:"Paytm", status:"succeeded", idempotencyKey:"order_10241", gatewayTransactionId:"paytm_81fd208e", routedBy:"balanced" },
  { id:"px_1a7e40c912", createdAt:new Date(Date.now()-1320000).toISOString(), amount:3499, currency:"INR", gateway:"Razorpay", status:"succeeded", idempotencyKey:"order_10240", gatewayTransactionId:"razorpay_21da0de2", routedBy:"lowest_fee" },
  { id:"px_4c9e2049ca", createdAt:new Date(Date.now()-2640000).toISOString(), amount:79, currency:"USD", gateway:"Stripe", status:"succeeded", idempotencyKey:"sub_8812", gatewayTransactionId:"stripe_9c7d0bb1", routedBy:"balanced" }
];

const money=(v:number,c:string)=>{try{return new Intl.NumberFormat("en-IN",{style:"currency",currency:c,maximumFractionDigits:c==="INR"?0:2}).format(v)}catch{return `${v} ${c}`}};

function App(){
  const [view,setView]=useState<View>("overview");
  const [gateways,setGateways]=useState<Gateway[]>(()=>JSON.parse(localStorage.getItem("payx_gateways")||"null")||defaultGateways);
  const [tx,setTx]=useState<Transaction[]>(()=>JSON.parse(localStorage.getItem("payx_transactions")||"null")||seed);
  const [toast,setToast]=useState("");
  useEffect(()=>localStorage.setItem("payx_gateways",JSON.stringify(gateways)),[gateways]);
  useEffect(()=>localStorage.setItem("payx_transactions",JSON.stringify(tx)),[tx]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(""),2200);return()=>clearTimeout(t)},[toast]);

  return <div className="app">
    <header className="nav">
      <button className="brand" onClick={()=>setView("overview")}><span>PX</span> PayX</button>
      <div className="navlinks">
        {(["overview","dashboard","gateways","docs"] as View[]).map(v=><button key={v} className={view===v?"active":""} onClick={()=>setView(v)}>{v==="docs"?"API Docs":v[0].toUpperCase()+v.slice(1)}</button>)}
      </div>
      <button className="cta" onClick={()=>setView("dashboard")}>Open sandbox</button>
    </header>

    {view==="overview"&&<Overview gateways={gateways} go={setView}/>}
    {view==="dashboard"&&<Dashboard gateways={gateways} tx={tx} setTx={setTx} notify={setToast}/>}
    {view==="gateways"&&<GatewayPage gateways={gateways} setGateways={setGateways} notify={setToast}/>}
    {view==="docs"&&<Docs/>}

    <footer><div><b>PayX</b><span>One API. Multiple gateways. Smarter payment infrastructure.</span></div><small>Sandbox demo · no real money movement · 2026</small></footer>
    {toast&&<div className="toast">{toast}</div>}
  </div>
}

function Overview({gateways,go}:{gateways:Gateway[];go:(v:View)=>void}){
  const features=[
    ["01","Unified payment API","One merchant-facing contract regardless of the provider used underneath."],
    ["02","Configurable routing","Route by resilience, fee or latency without moving provider logic into the merchant app."],
    ["03","Idempotency","A repeated request with the same key resolves to the existing transaction."],
    ["04","Gateway abstraction","Adapters isolate provider payloads and normalize responses into one PayX format."],
    ["05","Central ledger","Track status, amount, gateway, external IDs, routing mode and timestamps in one place."],
    ["06","Failover-ready design","Unavailable providers can be removed from eligible routing paths without changing the merchant API."]
  ];
  return <main>
    <section className="hero wrap">
      <div>
        <p className="kicker">PAYMENT INFRASTRUCTURE / ORCHESTRATION</p>
        <h1>Integrate payments <em>once.</em><br/>Orchestrate them everywhere.</h1>
        <p className="lead">PayX is a unified orchestration layer for commerce teams that need multiple payment gateways without multiplying integration complexity.</p>
        <div className="actions"><button className="primary" onClick={()=>go("dashboard")}>Launch live sandbox</button><button className="secondary" onClick={()=>go("docs")}>Read API docs</button></div>
        <div className="chips"><span>Unified API</span><span>Multi-gateway</span><span>Idempotent</span><span>Failover-ready</span></div>
      </div>
      <div className="terminal panel">
        <div className="terminalbar"><i/><i/><i/><small>orchestration.live</small></div>
        <div className="merchantNode">Merchant application</div><div className="vline"/>
        <div className="payxNode">PayX</div><div className="fan">↙ &nbsp;&nbsp; ↓ &nbsp;&nbsp; ↘</div>
        <div className="providers">{gateways.map(g=><div key={g.id} className={g.status}><b>{g.name}</b><small>{g.status}</small></div>)}</div>
        <div className="event"><span>latest route</span><b>order_10241 → Paytm</b><strong>219 ms</strong></div>
      </div>
    </section>

    <section className="section wrap">
      <p className="kicker">01 / THE PROBLEM</p><h2>Every gateway creates another integration surface.</h2>
      <div className="painGrid">{["Different APIs & SDKs","Gateway-specific business logic","Hard switching & vendor lock-in","Duplicate-payment risk on retries","Fragmented transaction tracking","More engineering work over time"].map((x,i)=><article key={x}><small>0{i+1}</small><h3>{x}</h3></article>)}</div>
    </section>

    <section className="paper">
      <div className="wrap split">
        <div><p className="kicker dark">02 / THE PAYX LAYER</p><h2>One contract in.<br/>Many gateways out.</h2><p>Merchants integrate once. PayX keeps provider-specific request shaping, routing decisions and normalized responses behind the orchestration boundary.</p></div>
        <div className="beforeAfter"><div><small>WITHOUT PAYX</small><p>App → Stripe</p><p>App → Razorpay</p><p>App → Other gateway</p></div><strong>→</strong><div><small>WITH PAYX</small><p>App → <b>PayX</b></p><p className="accent">→ Stripe / Razorpay / Paytm</p><p>one stable merchant API</p></div></div>
      </div>
    </section>

    <section className="section wrap"><p className="kicker">03 / CORE CAPABILITIES</p><h2>Payment infrastructure designed around developer control.</h2><div className="featureGrid">{features.map(([n,t,b])=><article key={n}><small>{n}</small><h3>{t}</h3><p>{b}</p></article>)}</div></section>

    <section className="section wrap"><p className="kicker">04 / ARCHITECTURE</p><h2>Modular by design.</h2><div className="arch">
      {["Merchant app","PayX API","Auth / authorization","Orchestration","Routing engine","Gateway adapters","Stripe · Razorpay · Paytm"].map((x,i)=><React.Fragment key={x}><div className={i===3?"focus":""}><b>{x}</b>{i===1&&<span>REST API</span>}{i===6&&<span>external providers</span>}</div>{i<6&&<i>→</i>}</React.Fragment>)}
      <p>PayX API → PostgreSQL → transactions · users · gateway configurations · subscriptions</p>
    </div></section>

    <section className="section wrap"><p className="kicker">05 / WHY ORCHESTRATION</p><h2>Less coupling. More optionality.</h2><div className="compare">
      <div><b>Dimension</b><b>Direct integration</b><b>PayX</b></div>
      {[["Integrations required","One per gateway","One PayX API"],["API consistency","Provider-specific","Unified"],["Gateway switching","Application changes","Adapter / config change"],["Transaction view","Fragmented","Centralized"],["Failover path","Custom work","Orchestration-ready"],["Vendor lock-in","Higher","Reduced"]].map(r=><div key={r[0]}><span>{r[0]}</span><span>{r[1]}</span><strong>{r[2]}</strong></div>)}
    </div></section>

    <section className="section wrap roadmap"><div><p className="kicker">06 / ROADMAP</p><h2>From orchestrator to payment control plane.</h2><p>Roadmap items are intentionally labelled as future scope rather than current implementation.</p></div><div>{[["Phase 1","More gateways · richer routing rules · dashboard analytics"],["Phase 2","Automated reconciliation · historical-performance routing · regional optimization"],["Phase 3","Fraud/risk integrations · payment optimization · SDKs · marketplace capabilities"]].map(x=><article key={x[0]}><small>{x[0]}</small><p>{x[1]}</p></article>)}</div></section>

    <section className="closing"><div className="wrap"><p className="kicker dark">PAYX / PAYMENT ORCHESTRATION</p><h2>Integrate payments once.<br/><em>Orchestrate them everywhere.</em></h2><button className="darkButton" onClick={()=>go("dashboard")}>Try the sandbox</button></div></section>
  </main>
}

function Dashboard({gateways,tx,setTx,notify}:{gateways:Gateway[];tx:Transaction[];setTx:(x:Transaction[])=>void;notify:(s:string)=>void}){
  const [amount,setAmount]=useState(1000),[currency,setCurrency]=useState("INR"),[rule,setRule]=useState<"balanced"|"lowest_fee"|"lowest_latency">("balanced"),[key,setKey]=useState("order_"+Math.floor(10000+Math.random()*90000)),[last,setLast]=useState<Transaction|null>(null);
  const enabled=gateways.filter(g=>g.enabled&&g.status!=="offline");
  const success=tx.length?Math.round(tx.filter(t=>t.status==="succeeded").length/tx.length*100):0;
  const volume=tx.reduce((s,t)=>s+(t.currency==="INR"?t.amount:0),0);
  const run=()=>{const r=simulatePayment({amount,currency,idempotencyKey:key,gateways,rule,existing:tx});setLast(r.transaction);if(!r.duplicate)setTx([r.transaction,...tx]);notify(r.duplicate?"Idempotency hit — existing transaction returned":`Routed to ${r.transaction.gateway}`)};
  return <main className="wrap page">
    <div className="pageHead"><div><p className="kicker">LIVE PRODUCT DEMO</p><h1>Payment control room.</h1><p>Create sandbox payments, change routing rules and watch PayX normalize the result.</p></div><span className="live">● system operational</span></div>
    <div className="metrics"><Metric l="Sandbox volume" v={money(volume,"INR")}/><Metric l="Transactions" v={String(tx.length)}/><Metric l="Success rate" v={success+"%"}/><Metric l="Eligible gateways" v={String(enabled.length)}/></div>
    <div className="dashGrid">
      <section className="panel form"><div className="panelHead"><div><small>POST /api/payments</small><h2>Create payment</h2></div><span>sandbox</span></div>
        <label>Amount<input type="number" value={amount} onChange={e=>setAmount(+e.target.value)}/></label>
        <div className="two"><label>Currency<select value={currency} onChange={e=>setCurrency(e.target.value)}><option>INR</option><option>USD</option><option>EUR</option></select></label><label>Routing<select value={rule} onChange={e=>setRule(e.target.value as typeof rule)}><option value="balanced">Balanced</option><option value="lowest_fee">Lowest fee</option><option value="lowest_latency">Lowest latency</option></select></label></div>
        <label>Idempotency key<input value={key} onChange={e=>setKey(e.target.value)}/><small>Retry the exact same key to verify duplicate protection.</small></label>
        <button className="primary wide" onClick={run}>Create payment</button>
        {last&&<div className={"result "+last.status}><small>normalized response</small><b>{last.status.toUpperCase()}</b><p><span>transaction</span>{last.id}</p><p><span>gateway</span>{last.gateway}</p><p><span>provider ID</span>{last.gatewayTransactionId}</p></div>}
      </section>
      <section className="panel"><div className="panelHead"><div><small>ORCHESTRATION</small><h2>Gateway health</h2></div></div>{gateways.map(g=><div className="health" key={g.id}><div><i className={g.status}/><b>{g.name}</b><small>{g.enabled?g.status:"disabled"}</small></div><div><span>{g.latency} ms</span><span>{g.successRate}%</span><span>{g.fee}% fee</span></div></div>)}</section>
    </div>
    <section className="panel ledger"><div className="panelHead"><div><small>CENTRAL LEDGER</small><h2>Recent transactions</h2></div><button className="secondary" onClick={()=>{setTx(seed);notify("Sandbox reset")}}>Reset demo</button></div><TransactionTable data={tx}/></section>
  </main>
}

function Metric({l,v}:{l:string;v:string}){return <div className="metric"><small>{l}</small><b>{v}</b></div>}
function TransactionTable({data}:{data:Transaction[]}){return <div className="scroll"><table><thead><tr><th>Transaction</th><th>Status</th><th>Amount</th><th>Gateway</th><th>Route</th><th>Created</th></tr></thead><tbody>{data.map(t=><tr key={t.id}><td><code>{t.id}</code><small>{t.idempotencyKey}</small></td><td><span className={"status "+t.status}>{t.status}</span></td><td>{money(t.amount,t.currency)}</td><td>{t.gateway}</td><td>{t.routedBy.replace("_"," ")}</td><td>{new Date(t.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</td></tr>)}</tbody></table></div>}

function GatewayPage({gateways,setGateways,notify}:{gateways:Gateway[];setGateways:(g:Gateway[])=>void;notify:(s:string)=>void}){
  const update=(id:string,p:Partial<Gateway>)=>setGateways(gateways.map(g=>g.id===id?{...g,...p}:g));
  return <main className="wrap page"><div className="pageHead"><div><p className="kicker">GATEWAY CONTROL</p><h1>Provider configuration.</h1><p>Enable, disable and simulate health without changing the merchant-facing contract.</p></div></div>
    <div className="gatewayCards">{gateways.map(g=><article className="panel" key={g.id}><div className="gatewayTitle"><div><i className={g.status}/><h2>{g.name}</h2></div><label className="switch"><input type="checkbox" checked={g.enabled} onChange={e=>{update(g.id,{enabled:e.target.checked});notify(`${g.name} ${e.target.checked?"enabled":"disabled"}`)}}/><span/></label></div>
      <div className="gstats"><div><small>success rate</small><b>{g.successRate}%</b></div><div><small>latency</small><b>{g.latency}ms</b></div><div><small>fee</small><b>{g.fee}%</b></div></div>
      <label>Health<select value={g.status} onChange={e=>update(g.id,{status:e.target.value as Gateway["status"]})}><option value="healthy">Healthy</option><option value="degraded">Degraded</option><option value="offline">Offline</option></select></label>
      <div className="secret"><small>credential storage</small><code>••••••••••••••••</code><span>Secrets intentionally hidden in demo UI</span></div>
    </article>)}</div>
    <section className="panel adapter"><p className="kicker">ADAPTER CONTRACT</p><h2>Merchant requests stay stable while provider implementations change independently.</h2><pre>{`interface GatewayAdapter {
  createPayment(input): Promise<GatewayResult>
  getPayment(id): Promise<GatewayResult>
  normalizeError(error): PayXError
}`}</pre></section>
  </main>
}

function Docs(){
  const sample=`curl -X POST https://api.payx.dev/api/payments \\\n  -H "Authorization: Bearer px_test_***" \\\n  -H "Idempotency-Key: order_10241" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "amount": 1000, "currency": "INR", "payment_method": "upi" }'`;
  return <main className="wrap page docs"><div className="pageHead"><div><p className="kicker">DEVELOPER EXPERIENCE</p><h1>One payment contract.</h1><p>The underlying provider can change. Your merchant integration does not.</p></div></div>
    <div className="docsGrid"><aside><a href="#create">Create payment</a><a href="#flow">Lifecycle</a><a href="#response">Unified response</a><a href="#security">Security</a><a href="#data">Data model</a></aside>
      <article>
        <section id="create"><small>POST</small><h2>/api/payments</h2><p>Creates a PayX transaction, checks idempotency, chooses a gateway using the active routing policy, transforms the request and normalizes the provider response.</p><pre>{sample}</pre></section>
        <section id="flow"><h2>Transaction lifecycle</h2><ol>{["Authenticate merchant","Validate request","Check idempotency","Create transaction record","Select gateway","Transform adapter payload","Call provider","Normalize response","Update transaction state","Return stable PayX response"].map(x=><li key={x}>{x}</li>)}</ol></section>
        <section id="response"><h2>Unified response</h2><pre>{`{
  "id": "px_8b13f9d201",
  "status": "succeeded",
  "amount": 1000,
  "currency": "INR",
  "gateway": "paytm",
  "gateway_transaction_id": "paytm_81fd208e"
}`}</pre></section>
        <section id="security"><h2>Security & reliability</h2><div className="security">{["Authentication & authorization","Idempotency keys","Secure credential handling","Transaction state management","Normalized error handling","Audit-friendly transaction records"].map(x=><span key={x}>{x}</span>)}</div><p className="muted">This demo does not claim certifications or production gateway credentials. Production compliance and secret storage require deployment-specific controls.</p></section>
        <section id="data"><h2>PostgreSQL-ready data model</h2><div className="entities"><b>users</b><b>gateway_configurations</b><b>transactions</b><b>subscriptions</b></div><p>Transactions retain internal ID, merchant, amount, currency, gateway, status, idempotency key, provider transaction ID and timestamps.</p></section>
      </article>
    </div>
  </main>
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
