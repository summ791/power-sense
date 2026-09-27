import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Download,
  FileCheck2,
  FileText,
  Gauge,
  History,
  Info,
  Menu,
  MoreHorizontal,
  Pencil,
  PlugZap,
  Printer,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import type { BillDraft, BillRecord } from "./types";
import { emptyBillDraft, draftFromRecord } from "./types";
import {
  analytics,
  billAmount,
  billUnits,
  chartRows,
  formatINR,
  formatNumber,
} from "./services/calculations";
import { extractBillText } from "./services/ocr";
import { parseElectricityBill, verifyDraft } from "./services/billParser";
import {
  deleteAllBills,
  deleteBill,
  getSourceFileUrl,
  listBills,
  saveBill,
  updateBill,
} from "./services/storage";
import {
  dataModeLabel,
  getSessionId,
  supabaseConfigured,
} from "./services/supabase";
import { predictNextMonth } from "./services/prediction";
import {
  TAMIL_NADU_TARIFF_OPTIONS,
  TAMIL_NADU_TARIFF_SOURCE,
  estimateTamilNaduBill,
  tariffCategoryLabel,
} from "./services/tariff";

const navItems = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/analysis", label: "Bill analysis", icon: FileCheck2 },
  { href: "/consumption", label: "Consumption", icon: BarChart3 },
  { href: "/prediction", label: "Prediction", icon: Activity },
  { href: "/history", label: "Bill history", icon: History },
];

const moneyFields: Array<keyof BillDraft> = [
  "energy_charge",
  "fixed_charge",
  "tax",
  "other_charge",
  "total_amount",
];
const numberFields: Array<keyof BillDraft> = [
  "previous_reading",
  "current_reading",
  "units_consumed",
  ...moneyFields,
];

function App() {
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [draft, setDraft] = useState<BillDraft>(emptyBillDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | undefined>();
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [location, navigate] = useLocation();

  const refresh = async () => {
    setLoading(true);
    try {
      setBills(await listBills());
    } catch (error) {
      setNotice({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to load saved bills.",
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    setMobileNav(false);
  }, [location]);
  useEffect(() => {
    if (notice) {
      const timer = window.setTimeout(() => setNotice(null), 6000);
      return () => window.clearTimeout(timer);
    }
  }, [notice]);

  const onFile = (file?: File) => {
    if (!file) {
      setPendingFile(undefined);
      return;
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    if (
      !allowed.includes(file.type) &&
      !/\.(pdf|jpe?g|png)$/i.test(file.name)
    ) {
      setNotice({
        type: "error",
        text: "Unsupported format. Select a PDF, JPG, JPEG or PNG electricity bill.",
      });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setNotice({
        type: "error",
        text: "This file is larger than 15 MB. Please upload a smaller scan.",
      });
      return;
    }
    setPendingFile(file);
    setNotice({
      type: "info",
      text: "File ready. Start analysis to extract bill fields.",
    });
  };

  const processFile = async () => {
    if (!pendingFile) return;
    setOcrBusy(true);
    setOcrProgress(0.05);
    try {
      const result = await extractBillText(pendingFile, setOcrProgress);
      const parsed = parseElectricityBill(result.text, result.confidence);
      setDraft(parsed);
      setEditingId(null);
      setOcrProgress(1);
      setNotice({
        type: "success",
        text: `Document processed across ${result.pages} page${result.pages === 1 ? "" : "s"}. Review the extracted fields before saving.`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "OCR could not read this document. Try a clearer scan.",
      });
    } finally {
      setOcrBusy(false);
    }
  };

  const persist = async () => {
    const verification = verifyDraft(draft);
    if (verification.negative || verification.impossibleReading) {
      setNotice({
        type: "error",
        text: "Check the meter readings and charge values. Negative consumption or impossible readings cannot be saved.",
      });
      return;
    }
    if (verification.invalidDate) {
      setNotice({
        type: "error",
        text: "A billing or due date is malformed. Correct or clear the date before saving.",
      });
      return;
    }
    if (
      draft.billing_date === "" ||
      draft.units_consumed === null ||
      draft.total_amount === null
    ) {
      setNotice({
        type: "error",
        text: "Add a valid billing date, units consumed, and total amount before saving. Other fields can be left blank if they are not shown on the bill.",
      });
      return;
    }
    const validationWarnings = [
      verification.mismatch && "Meter readings do not match units consumed.",
      verification.inconsistentCharges &&
        "The listed charge components do not reconcile with the total.",
    ].filter(Boolean);
    if (
      validationWarnings.length &&
      !window.confirm(
        `${validationWarnings.join("\n")} Review the values; save anyway only if the bill explains the difference.`
      )
    )
      return;
    try {
      if (editingId) await updateBill(editingId, draft);
      else await saveBill(draft, pendingFile);
      await refresh();
      setDraft(emptyBillDraft);
      setPendingFile(undefined);
      setEditingId(null);
      navigate("/history");
      setNotice({
        type: "success",
        text: "Bill saved to your current browser session.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        text:
          error instanceof Error ? error.message : "Unable to save this bill.",
      });
    }
  };

  const beginEdit = (bill: BillRecord) => {
    setDraft(draftFromRecord(bill));
    setEditingId(bill.id);
    navigate("/analysis");
  };
  const remove = async (bill: BillRecord) => {
    if (
      !window.confirm(
        "Delete this bill and its stored source file? This cannot be undone."
      )
    )
      return;
    try {
      await deleteBill(bill);
      await refresh();
      setNotice({ type: "success", text: "Bill deleted." });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to delete bill.",
      });
    }
  };
  const removeAll = async () => {
    if (
      !bills.length ||
      !window.confirm(
        "Delete every bill in this browser session? This cannot be undone."
      )
    )
      return;
    try {
      await deleteAllBills();
      await refresh();
      setNotice({ type: "success", text: "All session bills deleted." });
    } catch (error) {
      setNotice({
        type: "error",
        text:
          error instanceof Error ? error.message : "Unable to delete bills.",
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f6f8] text-slate-900">
      <Header mobileNav={mobileNav} setMobileNav={setMobileNav} />
      <div className="utility-strip">
        <div className="container flex items-center justify-between gap-3">
          <span className="truncate">
            Electricity Bill & Consumption Analysis Portal
          </span>
          <span className="status-live">
            <span className="status-dot" />
            Portal status: {supabaseConfigured ? "Connected" : "Setup required"}
          </span>
        </div>
      </div>
      {notice && (
        <div className={`notice ${notice.type}`} role="status">
          <div className="container flex items-center gap-3">
            <span className="notice-icon">
              {notice.type === "success" ? (
                <CheckCircle2 size={16} />
              ) : notice.type === "error" ? (
                <AlertTriangle size={16} />
              ) : (
                <Info size={16} />
              )}
            </span>
            <span>{notice.text}</span>
            <button
              className="ml-auto"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      <main className="container py-6 md:py-8">
        <Switch>
          <Route path="/">
            <Overview bills={bills} loading={loading} navigate={navigate} />
          </Route>
          <Route path="/analysis">
            <AnalysisPage
              bills={bills}
              draft={draft}
              setDraft={setDraft}
              pendingFile={pendingFile}
              onFile={onFile}
              onProcess={processFile}
              onSave={persist}
              onReset={() => {
                setDraft(emptyBillDraft);
                setEditingId(null);
                setPendingFile(undefined);
              }}
              busy={ocrBusy}
              progress={ocrProgress}
              editing={Boolean(editingId)}
              navigate={navigate}
            />
          </Route>
          <Route path="/consumption">
            <ConsumptionPage bills={bills} loading={loading} />
          </Route>
          <Route path="/prediction">
            <PredictionPage bills={bills} />
          </Route>
          <Route path="/history">
            <HistoryPage
              bills={bills}
              loading={loading}
              onEdit={beginEdit}
              onDelete={remove}
              onDeleteAll={removeAll}
            />
          </Route>
          <Route path="/help">
            <HelpPage />
          </Route>
          <Route path="/contact">
            <ContactPage />
          </Route>
          <Route>
            <NotFound />
          </Route>
        </Switch>
      </main>
      <Footer />
    </div>
  );
}

function Header({
  mobileNav,
  setMobileNav,
}: {
  mobileNav: boolean;
  setMobileNav: (value: boolean) => void;
}) {
  const [location] = useLocation();
  return (
    <header className="site-header">
      <div className="container header-main">
        <Link href="/" className="brand" aria-label="Power Sense home">
          <span className="brand-mark">
            <Zap size={23} strokeWidth={2.5} />
          </span>
          <span>
            <span className="brand-title">POWER SENSE</span>
            <span className="brand-subtitle">Electricity utility portal</span>
          </span>
        </Link>
        <div className="header-tools">
          <span className="session-badge">
            <ShieldCheck size={15} /> No login required
          </span>
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <Menu size={20} />
          </button>
        </div>
      </div>
      <nav
        className={`main-nav ${mobileNav ? "is-open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="container nav-inner">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-link ${location === href ? "active" : ""}`}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
          <span className="nav-spacer" />
          <Link
            href="/help"
            className={`nav-link ${location === "/help" ? "active" : ""}`}
          >
            <CircleHelp size={16} />
            Help
          </Link>
          <Link
            href="/contact"
            className={`nav-link ${location === "/contact" ? "active" : ""}`}
          >
            <BookOpen size={16} />
            Contact
          </Link>
        </div>
      </nav>
    </header>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow ?? "POWER SENSE"}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Overview({
  bills,
  loading,
  navigate,
}: {
  bills: BillRecord[];
  loading: boolean;
  navigate: (to: string) => void;
}) {
  const stats = analytics(bills);
  const recentBills = [...bills].sort((a, b) => {
    const aDate = Date.parse(a.billing_date || a.created_at) || 0;
    const bDate = Date.parse(b.billing_date || b.created_at) || 0;
    return bDate - aDate;
  });
  const latest = recentBills[0];
  const rows = chartRows(bills).slice(-6);
  const prediction = predictNextMonth(bills);
  return (
    <>
      <section className="welcome-band">
        <div>
          <div className="eyebrow light">DIGITAL CONSUMPTION SERVICES</div>
          <h1>Electricity bill analysis</h1>
          <p>
            Upload your electricity bill to review consumption, charges and
            estimated future usage.
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <button
              className="button button-light"
              onClick={() => navigate("/analysis")}
            >
              <Upload size={17} />
              Upload electricity bill
            </button>
            <button
              className="button button-ghost-light"
              onClick={() => navigate("/consumption")}
            >
              <BarChart3 size={17} />
              View consumption
            </button>
          </div>
        </div>
        <div className="welcome-seal">
          <PlugZap size={32} />
          <span>
            Session-based
            <br />
            secure records
          </span>
        </div>
      </section>
      <div className="section-rule">
        <span>Service overview</span>
        <span className="data-mode">
          <span className="status-dot" />
          {loading ? "Loading records" : dataModeLabel}
        </span>
      </div>
      <section className="summary-grid" aria-label="Consumption summary">
        <SummaryPanel
          icon={<FileText />}
          label="Latest bill amount"
          value={latest ? formatINR(billAmount(latest)) : "—"}
          sub={
            latest
              ? [latest.billing_period || latest.billing_date, latest.provider]
                  .filter(Boolean)
                  .join(" · ")
              : loading
                ? "Loading saved bills"
                : "No saved bill"
          }
        />
        <SummaryPanel
          icon={<Activity />}
          label="Latest consumption"
          value={
            latest && billUnits(latest) !== null
              ? `${formatNumber(billUnits(latest))} kWh`
              : "—"
          }
          sub={
            latest?.billing_period ||
            latest?.billing_date ||
            "Upload a bill to begin"
          }
        />
        <SummaryPanel
          icon={<BarChart3 />}
          label="Previous consumption"
          value={
            stats.previous !== null
              ? `${formatNumber(stats.previous)} kWh`
              : "—"
          }
          sub="Previous recorded month"
        />
        <SummaryPanel
          icon={<Calculator />}
          label="Average consumption"
          value={
            stats.average !== null ? `${formatNumber(stats.average)} kWh` : "—"
          }
          sub="All recorded bills"
        />
        <SummaryPanel
          icon={<Zap />}
          label="Highest consumption"
          value={
            stats.highest !== null ? `${formatNumber(stats.highest)} kWh` : "—"
          }
          sub="Highest recorded month"
        />
        <SummaryPanel
          icon={<Zap />}
          label="Lowest consumption"
          value={
            stats.lowest !== null ? `${formatNumber(stats.lowest)} kWh` : "—"
          }
          sub="Lowest recorded month"
        />
        <SummaryPanel
          icon={<ArrowRight />}
          label="Next-month estimate"
          value={
            prediction.predictedUnits !== null
              ? `${formatNumber(prediction.predictedUnits)} kWh`
              : "—"
          }
          sub={
            prediction.predictedUnits !== null
              ? "Trend-based estimate"
              : "More history required"
          }
        />
      </section>
      <section className="content-grid mt-6">
        <div className="panel panel-large">
          <div className="panel-heading">
            <div>
              <div className="panel-kicker">RECORDED CONSUMPTION</div>
              <h2>Monthly usage at a glance</h2>
            </div>
            <Link href="/consumption" className="text-link">
              Open analysis <ArrowRight size={15} />
            </Link>
          </div>
          {rows.length ? (
            <ChartFrame height={250}>
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1c78b8" stopOpacity={0.22} />
                    <stop
                      offset="100%"
                      stopColor="#1c78b8"
                      stopOpacity={0.01}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#dce5eb"
                />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip formatter={value => [`${value} kWh`, "Consumption"]} />
                <Area
                  type="monotone"
                  dataKey="units"
                  stroke="#1769aa"
                  strokeWidth={2.5}
                  fill="url(#usageFill)"
                  connectNulls
                />
              </AreaChart>
            </ChartFrame>
          ) : (
            <EmptyState compact onUpload={() => navigate("/analysis")} />
          )}
        </div>
        <div className="panel">
          <div className="panel-kicker">QUICK SERVICES</div>
          <h2 className="mb-4">Manage your records</h2>
          <div className="service-list">
            <ServiceLink
              icon={<FileCheck2 />}
              title="Analyse a bill"
              text="Extract and verify bill fields"
              href="/analysis"
            />
            <ServiceLink
              icon={<BarChart3 />}
              title="View consumption"
              text="Compare monthly usage"
              href="/consumption"
            />
            <ServiceLink
              icon={<Activity />}
              title="Future estimate"
              text="Review usage projections"
              href="/prediction"
            />
            <ServiceLink
              icon={<History />}
              title="Bill history"
              text="Search saved records"
              href="/history"
            />
          </div>
        </div>
      </section>
      <section className="panel mt-6">
        <div className="panel-heading">
          <div>
            <div className="panel-kicker">RECORDED BILL AMOUNTS</div>
            <h2>Monthly bill amount trend</h2>
          </div>
          <Link href="/consumption" className="text-link">
            Open analysis <ArrowRight size={15} />
          </Link>
        </div>
        {rows.some(row => row.amount !== null) ? (
          <ChartFrame height={250}>
            <BarChart data={rows}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#dce5eb"
              />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                formatter={value => [formatINR(Number(value)), "Bill amount"]}
              />
              <Bar dataKey="amount" fill="#2b8a78" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartFrame>
        ) : loading ? (
          <div className="loading-row">Loading recorded bill amounts…</div>
        ) : (
          <div className="loading-row">
            No verified monthly bill totals are available to chart yet.
          </div>
        )}
      </section>
      <section className="panel mt-6">
        <div className="panel-heading">
          <div>
            <div className="panel-kicker">MOST RECENT RECORDS</div>
            <h2>Recent bills</h2>
          </div>
          <Link href="/history" className="text-link">
            View all bills <ArrowRight size={15} />
          </Link>
        </div>
        {loading ? (
          <div className="loading-row">Loading saved bills…</div>
        ) : recentBills.length === 0 ? (
          <div className="loading-row">
            No bills have been saved in this browser session yet.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="bill-table">
              <caption className="sr-only">
                Recent saved electricity bills
              </caption>
              <thead>
                <tr>
                  <th>Billing period</th>
                  <th>Units</th>
                  <th>Total amount</th>
                  <th>Provider</th>
                  <th>Consumer number</th>
                </tr>
              </thead>
              <tbody>
                {recentBills.slice(0, 5).map(bill => (
                  <tr key={bill.id}>
                    <td>
                      <strong>
                        {bill.billing_period ||
                          bill.billing_date ||
                          "Unspecified"}
                      </strong>
                      <small>
                        {bill.billing_date || "Billing date unavailable"}
                      </small>
                    </td>
                    <td>
                      {billUnits(bill) !== null
                        ? `${formatNumber(billUnits(bill))} kWh`
                        : "—"}
                    </td>
                    <td>{formatINR(billAmount(bill))}</td>
                    <td>{bill.provider || "Not extracted"}</td>
                    <td>{bill.consumer_number || "Not extracted"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <InformationNotice />
    </>
  );
}

function SummaryPanel({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="summary-panel">
      <span className="summary-icon">{icon}</span>
      <div>
        <div className="summary-label">{label}</div>
        <div className="summary-value">{value}</div>
        <div className="summary-sub">{sub}</div>
      </div>
    </div>
  );
}
function ServiceLink({
  icon,
  title,
  text,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  href: string;
}) {
  return (
    <Link href={href} className="service-link">
      <span className="service-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <ArrowRight size={15} />
    </Link>
  );
}
function InformationNotice() {
  return (
    <section className="info-notice">
      <Info size={18} />
      <div>
        <strong>Important information</strong>
        <p>
          Upload a clear electricity bill and verify extracted meter readings.
          Future bill amounts are estimates; actual billing depends on the
          applicable tariff and charges.
        </p>
      </div>
    </section>
  );
}

function AnalysisPage({
  bills,
  draft,
  setDraft,
  pendingFile,
  onFile,
  onProcess,
  onSave,
  onReset,
  busy,
  progress,
  editing,
  navigate,
}: {
  bills: BillRecord[];
  draft: BillDraft;
  setDraft: (draft: BillDraft) => void;
  pendingFile?: File;
  onFile: (file?: File) => void;
  onProcess: () => void;
  onSave: () => void;
  onReset: () => void;
  busy: boolean;
  progress: number;
  editing: boolean;
  navigate: (to: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const verification = verifyDraft(draft);
  return (
    <>
      <PageHeading
        eyebrow="BILL ANALYSIS"
        title={editing ? "Edit saved bill" : "Electricity bill analysis"}
        description="Process a real bill, verify extracted information, and save the corrected record."
        action={
          <button
            className="button button-secondary"
            onClick={() => navigate("/history")}
          >
            <History size={16} />
            View history
          </button>
        }
      />
      <div className="analysis-layout">
        <section className="panel upload-panel">
          <div className="panel-kicker">STEP 01 · DOCUMENT INTAKE</div>
          <h2>Upload electricity bill</h2>
          <p className="panel-intro">
            Supported formats: PDF, JPG, JPEG and PNG. Clear, high-resolution
            scans produce better extraction.
          </p>
          <div
            className={`dropzone ${pendingFile ? "has-file" : ""}`}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              onFile(event.dataTransfer.files?.[0]);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ")
                inputRef.current?.click();
            }}
          >
            <input
              ref={inputRef}
              type="file"
              hidden
              accept="application/pdf,image/jpeg,image/png"
              onChange={event => onFile(event.target.files?.[0])}
            />
            {pendingFile ? (
              <>
                <div className="file-badge">
                  <FileText size={21} />
                </div>
                <strong>{pendingFile.name}</strong>
                <span>
                  {(pendingFile.size / 1024 / 1024).toFixed(2)} MB · Ready for
                  analysis
                </span>
                <button
                  className="text-link mt-2"
                  onClick={event => {
                    event.stopPropagation();
                    onFile(undefined);
                  }}
                >
                  Remove file
                </button>
              </>
            ) : (
              <>
                <div className="upload-icon">
                  <Upload size={22} />
                </div>
                <strong>Drop your bill here or browse files</strong>
                <span>PDF, JPG, JPEG or PNG · up to 15 MB</span>
              </>
            )}
          </div>
          {busy && (
            <div className="progress-wrap">
              <div className="flex justify-between text-xs">
                <span>Reading document with OCR…</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-value"
                  style={{ width: `${Math.max(5, progress * 100)}%` }}
                />
              </div>
            </div>
          )}
          <button
            className="button button-primary w-full mt-5"
            disabled={!pendingFile || busy}
            onClick={onProcess}
          >
            {busy ? "Processing document…" : "Upload & analyse"}
            <ArrowRight size={16} />
          </button>
          <div className="privacy-line">
            <ShieldCheck size={15} />
            Stored privately and associated with this browser session
          </div>
        </section>
        <section className="panel editor-panel">
          <div className="panel-kicker">STEP 02 · VERIFY & SAVE</div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2>Review extracted information</h2>
              <p className="panel-intro">
                Every field is editable. Confirm readings before saving to your
                history.
              </p>
            </div>
            {draft.ocr_confidence > 0 && (
              <span
                className={`confidence ${draft.ocr_confidence > 0.7 ? "good" : "caution"}`}
              >
                {Math.round(draft.ocr_confidence * 100)}% OCR confidence
              </span>
            )}
          </div>
          {verification.mismatch && (
            <div className="warning-box">
              <AlertTriangle size={17} />
              <div>
                <strong>Reading verification required</strong>
                <span>
                  Calculated consumption (
                  {formatNumber(verification.calculated)} kWh) differs from the
                  extracted units. Please verify the readings.
                </span>
              </div>
            </div>
          )}
          {verification.missingFields.length > 0 && (
            <div className="warning-box">
              <AlertTriangle size={17} />
              <div>
                <strong>Check missing bill details</strong>
                <span>
                  Not extracted: {verification.missingFields.join(", ")}. Review
                  the source bill and fill what is available.
                </span>
              </div>
            </div>
          )}
          {verification.negative && (
            <div className="warning-box error">
              <AlertTriangle size={17} />
              <div>
                <strong>Invalid meter readings</strong>
                <span>
                  Review readings and charges; usage, meter values and main
                  charges must not be negative.
                </span>
              </div>
            </div>
          )}
          {verification.impossibleReading && (
            <div className="warning-box error">
              <AlertTriangle size={17} />
              <div>
                <strong>Meter reading is outside a plausible range</strong>
                <span>
                  Check for OCR digit or decimal errors before saving.
                </span>
              </div>
            </div>
          )}
          {verification.invalidDate && (
            <div className="warning-box error">
              <AlertTriangle size={17} />
              <div>
                <strong>Invalid bill date</strong>
                <span>Correct or clear the malformed billing or due date.</span>
              </div>
            </div>
          )}
          {verification.inconsistentCharges && (
            <div className="warning-box">
              <AlertTriangle size={17} />
              <div>
                <strong>Charge total does not reconcile</strong>
                <span>
                  Energy, fixed charges, tax and other charges differ from the
                  total by more than the expected tolerance. Review the bill
                  before saving.
                </span>
              </div>
            </div>
          )}
          <div className="form-section">
            <div className="form-section-title">
              <span>Consumer information</span>
            </div>
            <div className="form-grid">
              <Field
                label="Consumer number"
                value={draft.consumer_number}
                onChange={value =>
                  setDraft({ ...draft, consumer_number: value })
                }
              />
              <Field
                label="Customer name"
                value={draft.customer_name}
                onChange={value => setDraft({ ...draft, customer_name: value })}
              />
              <Field
                label="Electricity provider"
                value={draft.provider}
                onChange={value => setDraft({ ...draft, provider: value })}
              />
              <Field
                label="Meter number"
                value={draft.meter_number}
                onChange={value => setDraft({ ...draft, meter_number: value })}
              />
            </div>
          </div>
          <div className="form-section">
            <div className="form-section-title">
              <span>Bill information</span>
            </div>
            <div className="form-grid">
              <Field
                label="Billing date"
                type="date"
                value={draft.billing_date}
                onChange={value => setDraft({ ...draft, billing_date: value })}
              />
              <Field
                label="Billing period"
                value={draft.billing_period}
                onChange={value =>
                  setDraft({ ...draft, billing_period: value })
                }
                placeholder="e.g. Aug 2026"
              />
              <Field
                label="Due date"
                type="date"
                value={draft.due_date}
                onChange={value => setDraft({ ...draft, due_date: value })}
              />
              <label className="field">
                <span>Tariff / category</span>
                <select
                  value={
                    draft.tariff === "residential" ||
                    draft.tariff === "commercial"
                      ? draft.tariff
                      : ""
                  }
                  onChange={event =>
                    setDraft({ ...draft, tariff: event.target.value })
                  }
                >
                  <option value="">Not identified / other provider</option>
                  {TAMIL_NADU_TARIFF_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Tariff or slab printed on bill"
                value={draft.tariff_description}
                onChange={value =>
                  setDraft({ ...draft, tariff_description: value })
                }
                placeholder="e.g. LT-IA, tariff code, or slab label"
              />
            </div>
          </div>
          <div className="form-section">
            <div className="form-section-title">
              <span>Meter readings & charges</span>
              <span className="form-helper">
                Amounts in ₹ · readings in kWh
              </span>
            </div>
            <div className="form-grid three">
              <Field
                label="Previous reading"
                number
                value={draft.previous_reading}
                onChange={value =>
                  setDraft({
                    ...draft,
                    previous_reading: value === "" ? null : Number(value),
                  })
                }
              />
              <Field
                label="Current reading"
                number
                value={draft.current_reading}
                onChange={value =>
                  setDraft({
                    ...draft,
                    current_reading: value === "" ? null : Number(value),
                  })
                }
              />
              <Field
                label="Units consumed"
                number
                value={draft.units_consumed}
                onChange={value =>
                  setDraft({
                    ...draft,
                    units_consumed: value === "" ? null : Number(value),
                  })
                }
              />
              <Field
                label="Energy charge"
                number
                value={draft.energy_charge}
                onChange={value =>
                  setDraft({
                    ...draft,
                    energy_charge: value === "" ? null : Number(value),
                  })
                }
              />
              <Field
                label="Fixed charge"
                number
                value={draft.fixed_charge}
                onChange={value =>
                  setDraft({
                    ...draft,
                    fixed_charge: value === "" ? null : Number(value),
                  })
                }
              />
              <Field
                label="Tax"
                number
                value={draft.tax}
                onChange={value =>
                  setDraft({
                    ...draft,
                    tax: value === "" ? null : Number(value),
                  })
                }
              />
              <Field
                label="Other charge"
                number
                value={draft.other_charge}
                onChange={value =>
                  setDraft({
                    ...draft,
                    other_charge: value === "" ? null : Number(value),
                  })
                }
              />
              <Field
                label="Total amount"
                number
                value={draft.total_amount}
                onChange={value =>
                  setDraft({
                    ...draft,
                    total_amount: value === "" ? null : Number(value),
                  })
                }
              />
            </div>
          </div>
          <div className="editor-actions">
            <button className="button button-secondary" onClick={onReset}>
              <X size={16} />
              Clear
            </button>
            <button className="button button-primary" onClick={onSave}>
              <Save size={16} />
              {editing ? "Update bill" : "Save bill"}
            </button>
          </div>
        </section>
      </div>
      <div className="process-note">
        <FileCheck2 size={16} />
        <span>
          OCR reads the actual uploaded file in your browser. Always verify
          extracted values because bill layouts and scan quality vary.
        </span>
      </div>
      <div className="small-note mt-4">
        <Info size={15} />
        <span>
          {draft.tariff ? (
            <>
              <strong>{tariffCategoryLabel(draft.tariff)}</strong> Tamil Nadu
              model only: the illustrative estimate uses the TNERC FY 2025-26
              schedule effective 1 July 2025.{" "}
              <a
                href={TAMIL_NADU_TARIFF_SOURCE}
                target="_blank"
                rel="noreferrer"
              >
                View official tariff order
              </a>
              .{" "}
              {draft.units_consumed !== null
                ? `Indicative amount: ₹${Math.round(estimateTamilNaduBill(draft.units_consumed, draft.tariff === "commercial" ? "commercial" : "residential").total).toLocaleString("en-IN")}. This is not a provider bill.`
                : "Enter units to see an illustrative estimate."}
            </>
          ) : (
            "No tariff-based amount is shown for an unknown or other-provider category. The next-month bill estimate uses actual saved bill totals only when there is enough history."
          )}
        </span>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  number = false,
  placeholder,
}: {
  label: string;
  value: string | number | null;
  onChange: (value: string) => void;
  type?: string;
  number?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={number ? "number" : type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  );
}

function ConsumptionPage({
  bills,
  loading,
}: {
  bills: BillRecord[];
  loading: boolean;
}) {
  const stats = analytics(bills);
  const rows = chartRows(bills);
  return (
    <>
      <PageHeading
        eyebrow="CONSUMPTION MONITORING"
        title="Electricity consumption analysis"
        description="Compare recorded usage and billing amounts across your saved electricity bills."
        action={
          <span className="data-mode">
            <span className="status-dot" />
            {loading
              ? "Loading"
              : `${bills.length} recorded bill${bills.length === 1 ? "" : "s"}`}
          </span>
        }
      />
      <section className="metric-row">
        <Metric
          label="Current consumption"
          value={
            stats.current !== null ? `${formatNumber(stats.current)} kWh` : "—"
          }
        />
        <Metric
          label="Previous consumption"
          value={
            stats.previous !== null
              ? `${formatNumber(stats.previous)} kWh`
              : "—"
          }
        />
        <Metric
          label="Difference"
          value={
            stats.difference !== null
              ? `${stats.difference >= 0 ? "+" : ""}${formatNumber(stats.difference)} kWh`
              : "—"
          }
          tone={
            stats.difference !== null && stats.difference > 0
              ? "warning"
              : "positive"
          }
        />
        <Metric
          label="Change"
          value={
            stats.change !== null
              ? `${stats.change >= 0 ? "+" : ""}${formatNumber(stats.change, 1)}%`
              : "—"
          }
          tone={
            stats.change !== null && stats.change > 0 ? "warning" : "positive"
          }
        />
      </section>
      <section className="content-grid mt-6">
        <div className="panel panel-large">
          <div className="panel-heading">
            <div>
              <div className="panel-kicker">KILOWATT-HOUR TREND</div>
              <h2>Monthly consumption</h2>
            </div>
          </div>
          {rows.length ? (
            <ChartFrame height={300}>
              <LineChart data={rows}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#dce5eb"
                />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={38}
                />
                <Tooltip formatter={value => [`${value} kWh`, "Consumption"]} />
                <Line
                  type="monotone"
                  dataKey="units"
                  stroke="#1769aa"
                  strokeWidth={2.7}
                  dot={{ r: 3, fill: "#1769aa" }}
                  connectNulls
                />
              </LineChart>
            </ChartFrame>
          ) : (
            <EmptyState />
          )}
        </div>
        <div className="panel">
          <div className="panel-kicker">BILLING TREND</div>
          <h2>Monthly bill</h2>
          {rows.length ? (
            <ChartFrame height={300}>
              <BarChart data={rows}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#dce5eb"
                />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={45}
                />
                <Tooltip
                  formatter={value => [formatINR(Number(value)), "Bill amount"]}
                />
                <Bar dataKey="amount" fill="#2b8a78" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartFrame>
          ) : (
            <EmptyState compact />
          )}
        </div>
      </section>
      <section className="panel mt-6">
        <div className="panel-heading">
          <div>
            <div className="panel-kicker">STATISTICAL SUMMARY</div>
            <h2>Consumption indicators</h2>
          </div>
        </div>
        <div className="indicator-table">
          <Indicator
            label="Average consumption"
            value={
              stats.average !== null
                ? `${formatNumber(stats.average)} kWh`
                : "—"
            }
          />
          <Indicator
            label="Three-month average"
            value={
              stats.threeMonthAverage !== null
                ? `${formatNumber(stats.threeMonthAverage)} kWh`
                : "—"
            }
          />
          <Indicator
            label="Six-month average"
            value={
              stats.sixMonthAverage !== null
                ? `${formatNumber(stats.sixMonthAverage)} kWh`
                : "—"
            }
          />
          <Indicator
            label="Highest recorded usage"
            value={
              stats.highest !== null
                ? `${formatNumber(stats.highest)} kWh`
                : "—"
            }
          />
          <Indicator
            label="Lowest recorded usage"
            value={
              stats.lowest !== null ? `${formatNumber(stats.lowest)} kWh` : "—"
            }
          />
        </div>
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning" | "positive";
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone ?? ""}>{value}</strong>
    </div>
  );
}
function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <div className="indicator">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function ChartFrame({
  children,
  height,
}: {
  children: React.ReactNode;
  height: number;
}) {
  return (
    <div style={{ width: "100%", height }} aria-label="Data chart">
      {" "}
      <ResponsiveContainer width="100%" height="100%">
        {children as any}
      </ResponsiveContainer>
    </div>
  );
}

function PredictionPage({ bills }: { bills: BillRecord[] }) {
  const prediction = predictNextMonth(bills);
  const stats = analytics(bills);
  return (
    <>
      <PageHeading
        eyebrow="FORECASTING SERVICE"
        title="Next-month prediction"
        description="A transparent estimate based on your recorded consumption history—not an official electricity bill."
        action={
          <span className="estimate-label">
            <Activity size={15} />
            Informational estimate
          </span>
        }
      />
      {prediction.predictedUnits === null ? (
        <div className="empty-panel">
          <div className="empty-icon">
            <Activity size={24} />
          </div>
          <h2>More historical data is required.</h2>
          <p>
            Save at least two verified bills to calculate a trend-based
            next-month estimate. Prediction quality improves as more monthly
            records are added.
          </p>
          <Link href="/analysis" className="button button-primary">
            <Upload size={16} />
            Upload a bill
          </Link>
        </div>
      ) : (
        <>
          <section className="prediction-hero">
            <div>
              <div className="eyebrow light">
                ESTIMATED NEXT-MONTH CONSUMPTION
              </div>
              <div className="prediction-number">
                {formatNumber(prediction.predictedUnits)} <span>kWh</span>
              </div>
              <p>
                Expected range:{" "}
                <strong>
                  {formatNumber(prediction.rangeLow)}–
                  {formatNumber(prediction.rangeHigh)} kWh
                </strong>
              </p>
            </div>
            <div className="prediction-side">
              <span>Historical bill-based range</span>
              <strong>
                {prediction.predictedBillLow === null
                  ? "Unavailable"
                  : `${formatINR(prediction.predictedBillLow)} – ${formatINR(prediction.predictedBillHigh)}`}
              </strong>
              <small>
                {prediction.billMethod} Actual charges can vary with tariff,
                subsidy, duty, arrears, billing cycle and other adjustments.
              </small>
            </div>
          </section>
          <section className="content-grid mt-6">
            <div className="panel">
              <div className="panel-kicker">PREDICTION BASIS</div>
              <h2>How this estimate is formed</h2>
              <div className="method-list">
                <Method
                  number="01"
                  title="Recorded history"
                  text={prediction.basis}
                />
                <Method
                  number="02"
                  title="Calculation method"
                  text={prediction.method}
                />
                <Method
                  number="03"
                  title="Bill amount estimate"
                  text={
                    prediction.billMethod ??
                    "Not available without verified historical bill totals; no tariff has been assumed."
                  }
                />
              </div>
            </div>
            <div className="panel">
              <div className="panel-kicker">FITTING INDICATORS</div>
              <h2>Model performance</h2>
              <div className="performance-grid">
                <div>
                  <span>MAE</span>
                  <strong>
                    {prediction.mae !== null
                      ? `${formatNumber(prediction.mae, 1)} kWh`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>MAPE</span>
                  <strong>
                    {prediction.mape !== null
                      ? `${formatNumber(prediction.mape, 1)}%`
                      : "—"}
                  </strong>
                </div>
              </div>
              <div className="small-note">
                <Info size={15} />
                Accuracy indicators are shown only when enough history is
                available for back-testing.
              </div>
              <div className="insight-list mt-5">
                <Insight
                  text={
                    stats.change !== null
                      ? `Your latest consumption changed by ${formatNumber(Math.abs(stats.change), 1)}% compared with the previous recorded month.`
                      : "Add another bill to compare month-to-month change."
                  }
                />
                <Insight
                  text={
                    stats.sixMonthAverage !== null &&
                    stats.current !== null &&
                    stats.current > stats.sixMonthAverage
                      ? "Current consumption is above your six-month average."
                      : "The estimate uses your recorded consumption history."
                  }
                />
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
function Method({
  number,
  title,
  text,
}: {
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div className="method">
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Insight({ text }: { text: string }) {
  return (
    <div className="insight">
      <CheckCircle2 size={16} />
      <span>{text}</span>
    </div>
  );
}

function downloadExport(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
function exportBills(bills: BillRecord[], format: "csv" | "json") {
  if (format === "json")
    downloadExport(
      "power-sense-bills.json",
      JSON.stringify(bills, null, 2),
      "application/json"
    );
  else {
    const headers = [
      "billing_period",
      "billing_date",
      "provider",
      "consumer_number",
      "units_consumed",
      "total_amount",
    ];
    const csv = [
      headers.join(","),
      ...bills.map(bill =>
        headers
          .map(key =>
            JSON.stringify(
              (bill as unknown as Record<string, unknown>)[key] ?? ""
            )
          )
          .join(",")
      ),
    ].join("\n");
    downloadExport("power-sense-bills.csv", csv, "text/csv");
  }
}
function HistoryPage({
  bills,
  loading,
  onEdit,
  onDelete,
  onDeleteAll,
}: {
  bills: BillRecord[];
  loading: boolean;
  onEdit: (bill: BillRecord) => void;
  onDelete: (bill: BillRecord) => void;
  onDeleteAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedBill, setSelectedBill] = useState<BillRecord | null>(null);
  const [sourceFileUrl, setSourceFileUrl] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const openSourceFile = async () => {
    if (!selectedBill?.source_file_path) return;
    setFileBusy(true);
    setFileError("");
    try {
      setSourceFileUrl(await getSourceFileUrl(selectedBill.source_file_path));
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Unable to open the source file."
      );
    } finally {
      setFileBusy(false);
    }
  };
  const filtered = bills.filter(bill =>
    [
      bill.billing_period,
      bill.provider,
      bill.consumer_number,
      bill.customer_name,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  return (
    <>
      <PageHeading
        eyebrow="RECORDS & DOCUMENTS"
        title="Bill history"
        description="Review and manage electricity bills saved to your current browser session."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/analysis" className="button button-primary">
              <Upload size={16} />
              Upload bill
            </Link>
            {bills.length > 0 && (
              <>
                <button
                  className="button button-secondary"
                  onClick={() => exportBills(bills, "csv")}
                >
                  <Download size={15} />
                  CSV
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => exportBills(bills, "json")}
                >
                  <Download size={15} />
                  JSON
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => window.print()}
                >
                  <Printer size={15} />
                  Print
                </button>
                <button
                  className="button button-danger-outline"
                  onClick={onDeleteAll}
                >
                  <Trash2 size={15} />
                  Delete all
                </button>
              </>
            )}
          </div>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="Search bills"
              placeholder="Search provider, consumer or period"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <span className="result-count">
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
        {loading ? (
          <div className="loading-row">Loading saved records…</div>
        ) : filtered.length === 0 ? (
          <EmptyState onUpload={() => window.location.assign("/analysis")} />
        ) : (
          <div className="table-scroll">
            <table className="bill-table">
              <caption className="sr-only">Saved electricity bills</caption>
              <thead>
                <tr>
                  <th>Billing period</th>
                  <th>Units</th>
                  <th>Bill amount</th>
                  <th>Provider</th>
                  <th>Saved on</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(bill => (
                  <tr key={bill.id}>
                    <td>
                      <strong>
                        {bill.billing_period ||
                          bill.billing_date ||
                          "Unspecified"}
                      </strong>
                      <small>
                        {bill.consumer_number || "Consumer number unavailable"}
                      </small>
                    </td>
                    <td>
                      {billUnits(bill) !== null
                        ? `${formatNumber(billUnits(bill))} kWh`
                        : "—"}
                    </td>
                    <td>{formatINR(billAmount(bill))}</td>
                    <td>{bill.provider || "Not extracted"}</td>
                    <td>
                      {new Date(bill.created_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label="View bill details"
                          title="View bill details"
                          onClick={() => {
                            setSelectedBill(bill);
                            setSourceFileUrl(null);
                            setFileError("");
                          }}
                        >
                          <FileCheck2 size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Edit bill"
                          onClick={() => onEdit(bill)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label="Delete bill"
                          onClick={() => onDelete(bill)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selectedBill && (
        <section className="panel mt-5" aria-label="Bill details">
          <div className="panel-heading">
            <div>
              <div className="panel-kicker">SAVED BILL DETAILS</div>
              <h2>
                {selectedBill.billing_period ||
                  selectedBill.billing_date ||
                  "Electricity bill"}
              </h2>
            </div>
            <button
              className="button button-secondary"
              onClick={() => setSelectedBill(null)}
            >
              <X size={15} />
              Close details
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem
              label="Provider"
              value={selectedBill.provider || "Not recorded"}
            />
            <DetailItem
              label="Consumer number"
              value={selectedBill.consumer_number || "Not recorded"}
            />
            <DetailItem
              label="Customer name"
              value={selectedBill.customer_name || "Not recorded"}
            />
            <DetailItem
              label="Meter number"
              value={selectedBill.meter_number || "Not recorded"}
            />
            <DetailItem
              label="Billing date / period"
              value={`${selectedBill.billing_date || "Not recorded"}${selectedBill.billing_period ? ` · ${selectedBill.billing_period}` : ""}`}
            />
            <DetailItem
              label="Due date"
              value={selectedBill.due_date || "Not recorded"}
            />
            <DetailItem
              label="Previous reading"
              value={
                selectedBill.previous_reading === null
                  ? "—"
                  : `${formatNumber(selectedBill.previous_reading)} kWh`
              }
            />
            <DetailItem
              label="Current reading"
              value={
                selectedBill.current_reading === null
                  ? "—"
                  : `${formatNumber(selectedBill.current_reading)} kWh`
              }
            />
            <DetailItem
              label="Units consumed"
              value={
                billUnits(selectedBill) === null
                  ? "—"
                  : `${formatNumber(billUnits(selectedBill))} kWh`
              }
            />
            <DetailItem
              label="Energy charge"
              value={formatINR(selectedBill.energy_charge)}
            />
            <DetailItem
              label="Fixed charge"
              value={formatINR(selectedBill.fixed_charge)}
            />
            <DetailItem
              label="Tax / duty"
              value={formatINR(selectedBill.tax)}
            />
            <DetailItem
              label="Other charges"
              value={formatINR(selectedBill.other_charge)}
            />
            <DetailItem
              label="Total amount"
              value={formatINR(selectedBill.total_amount)}
            />
            <DetailItem
              label="Tariff / slab"
              value={
                selectedBill.tariff_description ||
                selectedBill.tariff ||
                "Not recorded"
              }
            />
            <DetailItem
              label="OCR confidence"
              value={`${Math.round(selectedBill.ocr_confidence * 100)}%`}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {selectedBill.source_file_path ? (
              sourceFileUrl ? (
                <a
                  className="button button-secondary"
                  href={sourceFileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileText size={15} />
                  Open original bill (temporary link)
                </a>
              ) : (
                <button
                  className="button button-secondary"
                  disabled={fileBusy}
                  onClick={openSourceFile}
                >
                  <FileText size={15} />
                  {fileBusy ? "Preparing file…" : "View original bill"}
                </button>
              )
            ) : (
              <span className="form-helper">
                No original source file is attached to this record.
              </span>
            )}
            {fileError && (
              <span className="text-sm text-red-700">{fileError}</span>
            )}
          </div>
        </section>
      )}
      <div className="privacy-card">
        <ShieldCheck size={18} />
        <div>
          <strong>Privacy notice</strong>
          <p>
            Your bills are stored in Supabase and associated with a random ID in
            this browser. The database and private file bucket check that ID on
            every request; the ID is the browser's bearer session token, so keep
            this browser profile private. No account or login is required.
          </p>
        </div>
      </div>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <strong className="mt-1 block break-words text-sm text-slate-900">
        {value}
      </strong>
    </div>
  );
}

function HelpPage() {
  return (
    <>
      <PageHeading
        eyebrow="USER SUPPORT"
        title="Help & guidance"
        description="A short guide to getting reliable results from the portal."
      />
      <section className="help-grid">
        <HelpCard
          icon={<Upload />}
          title="Upload a clear document"
          text="Use a well-lit, high-resolution scan. PDF, JPG, JPEG and PNG bills are supported up to 15 MB."
        />
        <HelpCard
          icon={<FileCheck2 />}
          title="Verify extracted fields"
          text="OCR is assisted reading. Check the consumer information, meter readings, units and total amount before saving."
        />
        <HelpCard
          icon={<Calculator />}
          title="Understand estimates"
          text="Predictions use your saved consumption history. They are indicative only and are not official bills."
        />
        <HelpCard
          icon={<ShieldCheck />}
          title="Session privacy"
          text="No account is created. A browser session ID keeps your records separated from other sessions when Supabase is configured."
        />
      </section>
      <section className="panel faq-panel">
        <div className="panel-kicker">COMMON QUESTIONS</div>
        <h2>Before you begin</h2>
        <details open>
          <summary>Why does a reading mismatch warning appear?</summary>
          <p>
            The portal calculates current reading minus previous reading and
            compares it with the units printed on the bill. If the values
            differ, review and correct the editable fields.
          </p>
        </details>
        <details>
          <summary>How is the next bill estimated?</summary>
          <p>
            Consumption is estimated from saved monthly usage. A bill amount is
            shown only when at least two saved months contain verified bill
            totals; the estimate is fitted to those observed amounts and does
            not assume an unknown provider tariff.
          </p>
        </details>
        <details>
          <summary>What happens if cloud storage is unavailable?</summary>
          <p>
            OCR and review happen in your browser. Bill records and original
            documents are not saved to localStorage; saving requires the
            configured Supabase connection. If the service is unavailable, the
            page shows an error and does not silently fall back to fake or local
            records.
          </p>
        </details>
      </section>
    </>
  );
}
function HelpCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="help-card">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function ContactPage() {
  return (
    <>
      <PageHeading
        eyebrow="PORTAL INFORMATION"
        title="Contact & service information"
        description="Power Sense is a self-service analysis portal for personal electricity bill records."
      />
      <section className="contact-grid">
        <div className="panel">
          <div className="panel-kicker">SERVICE DESK</div>
          <h2>Need assistance with a bill?</h2>
          <p className="panel-intro">
            For official billing corrections, payment issues or supply
            complaints, contact the electricity distribution company listed on
            your bill. Power Sense does not issue bills or alter provider
            records.
          </p>
          <div className="contact-line">
            <Bell size={17} />
            <span>
              Use your provider's official helpline printed on the bill.
            </span>
          </div>
          <div className="contact-line">
            <FileText size={17} />
            <span>
              Keep your consumer number ready when contacting the provider.
            </span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-kicker">ABOUT THIS PORTAL</div>
          <h2>Power Sense</h2>
          <p className="panel-intro">
            A browser-based tool to organize bill readings, understand
            consumption trends and create transparent indicative estimates.
          </p>
          <div className="portal-facts">
            <div>
              <span>Access</span>
              <strong>Open, no login</strong>
            </div>
            <div>
              <span>Storage</span>
              <strong>
                {supabaseConfigured
                  ? "Supabase private storage"
                  : "Cloud storage unavailable"}
              </strong>
            </div>
            <div>
              <span>Session</span>
              <strong>{getSessionId().slice(0, 8)}…</strong>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
function NotFound() {
  return (
    <div className="empty-panel">
      <div className="empty-icon">
        <FileText size={24} />
      </div>
      <h2>Page not found</h2>
      <p>The requested portal page could not be found.</p>
      <Link href="/" className="button button-primary">
        Return to overview
      </Link>
    </div>
  );
}
function EmptyState({
  compact = false,
  onUpload,
}: {
  compact?: boolean;
  onUpload?: () => void;
}) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <div className="empty-icon">
        <ClipboardList size={22} />
      </div>
      <strong>No electricity bills have been added yet.</strong>
      <span>
        Upload your first electricity bill to begin tracking your consumption.
      </span>
      {onUpload && (
        <button className="button button-secondary mt-3" onClick={onUpload}>
          <Upload size={15} />
          Upload electricity bill
        </button>
      )}
    </div>
  );
}
function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div>
          <strong>POWER SENSE</strong>
          <span>Electricity Bill & Consumption Analysis Portal</span>
        </div>
        <div className="footer-links">
          <Link href="/help">Help</Link>
          <Link href="/contact">Contact</Link>
          <span>Data stays session-scoped</span>
        </div>
      </div>
    </footer>
  );
}

export default App;
