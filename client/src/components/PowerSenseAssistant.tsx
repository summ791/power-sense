import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, MessageCircle, Send, Sparkles, X, Zap } from "lucide-react";
import { estimateTamilNaduBill, inferTamilNaduBillingCycle, normaliseTamilNaduCategory } from "../services/tariff";

type ChatMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

const quickQuestions = [
  "How do I analyse a bill?",
  "How are electricity units calculated?",
  "How does the Tamil Nadu subsidy work?",
  "What is the difference between residential and commercial?",
  "Why is my bill showing a warning?",
  "How can I reduce my electricity bill?",
];

const openingMessage: ChatMessage = {
  id: 1,
  role: "assistant",
  text: "Hello. I’m the Power Sense Assistant. I can guide you through bill OCR, Tamil Nadu residential and commercial tariff rules, subsidies, warnings, and your usage forecast. What would you like to understand?",
};

function answerFor(question: string): string {
  const text = question.toLowerCase().trim();

  if (!text) {
    return "Please type a question or choose one of the suggested topics below.";
  }
  const readingMatch = text.match(/(?:previous|opening|from)\D*(\d+(?:\.\d+)?)\D+(?:current|present|to)\D*(\d+(?:\.\d+)?)/);
  if (readingMatch) {
    const previous = Number(readingMatch[1]);
    const current = Number(readingMatch[2]);
    const units = current - previous;
    return units >= 0
      ? `Your calculated consumption is ${units.toLocaleString("en-IN")} units: current reading ${current} minus previous reading ${previous}. Compare this with the Units Consumed field on the bill before saving.`
      : `The readings produce a negative result: ${current} minus ${previous}. Check whether the meter rolled over or the readings were entered in the wrong order.`;
  }
  const unitsMatch = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:units?|kwh)/);
  if (unitsMatch && /estimate|calculate|amount|cost|price|bill/.test(text)) {
    const units = Number(unitsMatch[1].replace(/,/g, ""));
    const category = normaliseTamilNaduCategory(text);
    const cycle = inferTamilNaduBillingCycle(text);
    const loadMatch = text.match(/(\d+(?:\.\d+)?)\s*kw/);
    const estimate = estimateTamilNaduBill(units, category, { billingCycle: cycle, connectedLoadKw: loadMatch ? Number(loadMatch[1]) : undefined });
    return `Indicative ${category} estimate for ${units.toLocaleString("en-IN")} units on a ${cycle} cycle: ₹${Math.round(estimate.total).toLocaleString("en-IN")}. Payable units after the configured rule: ${estimate.payableUnits}. This excludes provider-specific arrears, corrections, and special adjustments.`;
  }
  if (/upload|analyse|analy[sz]|scan|pdf|image|ocr|extract/.test(text)) {
    return "Open Bill analysis, choose a PDF, JPG, JPEG, or PNG bill, and select Start analysis. Power Sense extracts the text in your browser, then shows every field for review. Correct any reading or amount before saving it to your account.";
  }
  if (/subsid|free unit|200|500 unit|bi.monthly|bi monthly/.test(text)) {
    return "For the configured Tamil Nadu domestic bi-monthly rule, consumption up to and including 500 units receives 200 free units. Above 500 units, 100 free units apply. Commercial consumers and monthly cycles do not receive this domestic subsidy. The provider bill remains the final authority.";
  }
  if (/commercial|business|shop|office|lt.v|load/.test(text)) {
    return "Choose the commercial category when reviewing a business bill. The calculator uses the Tamil Nadu commercial tariff path and connected-load information where available. The residential domestic subsidy is not applied to commercial bills.";
  }
  if (/residential|domestic|house|home|lt.ia/.test(text)) {
    return "Residential/domestic bills use the Tamil Nadu LT-IA progressive slab path. Enter the billing cycle and units consumed carefully because the bi-monthly subsidy boundary can change the payable units.";
  }
  if (/warning|yellow|mismatch|reading|reconcil|charge|error/.test(text)) {
    return "A warning usually means the current reading minus the previous reading does not match the extracted units, or the listed energy, fixed, tax, and other charges do not reconcile to the total. Edit the extracted fields and compare them with the printed bill before saving.";
  }
  if (/unit|kwh|meter reading|current reading|previous reading/.test(text)) {
    return "Electricity consumption is normally calculated as current meter reading minus previous meter reading. Check the billing period, meter number, rollover, and the printed Units Consumed field; correct OCR values before saving if they disagree.";
  }
  if (/reduce|lower|save|saving|high bill|too much|consumption tips|efficient/.test(text)) {
    return "To reduce consumption, check air-conditioner temperature and hours, avoid standby loads, use efficient appliances, maintain refrigerators, and compare month-to-month units rather than only the rupee amount. The Consumption page helps identify rising usage.";
  }
  if (/due date|late fee|penalty|arrear|arrears|rebate|disconnection/.test(text)) {
    return "Due dates, late fees, arrears, rebates, and disconnection notices are provider-specific. Power Sense can extract and display those fields, but the official bill or provider portal is the authority for payment status and penalties.";
  }
  if (/provider|tangedco|tnpdcl|consumer number|service id|service number|meter number/.test(text)) {
    return "The provider, consumer/service number, and meter number identify the supply account. Check that these fields match the bill before saving; they are not the same as the amount payable or the units consumed.";
  }
  if (/energy charge|fixed charge|electricity tax|tax|other charge|what is a charge/.test(text)) {
    return "Energy charge is the usage-based part of the bill. Fixed charge depends on the category, cycle, or connected load. Tax and other charges may be provider-specific. Compare the itemized amounts with the total and use the official bill for final payment.";
  }
  if (/power cut|outage|fault|complaint|emergency|danger|wire|shock/.test(text)) {
    return "For an outage, damaged line, electrical shock, fire, or other emergency, contact your electricity provider or local emergency service immediately. Power Sense is for bill analysis and does not dispatch field service.";
  }
  if (/forecast|predict|prediction|future|next month|history|trend/.test(text)) {
    return "Prediction uses the bills saved in your account. With limited history it uses a weighted average; with four or more chronological bills it fits a least-squares trend and reports an indicative range. It is an estimate, not an official provider bill.";
  }
  if (/save|history|delete|account|private|privacy|stored|secure/.test(text)) {
    return "Saved bills and source documents are account-scoped. After reviewing OCR fields, save the bill to Bill history. You can edit, export, or delete your records from there; the provider’s official bill should always be retained for final verification.";
  }
  if (/tariff|rate|slab|unit price|amount|calculate|calculator|bill amount/.test(text)) {
    return "The calculator separates residential and commercial categories, applies the configured Tamil Nadu progressive tariff rules, handles billing-cycle and connected-load inputs, and shows an indicative amount. It does not replace the official provider bill, arrears, meter corrections, or special adjustments.";
  }
  if (/hello|hi|help|what can you do|start/.test(text)) {
    return "I can help with bill OCR, meter-unit calculations, Tamil Nadu residential and commercial tariffs, 100/200-unit subsidy rules, charges and due dates, savings tips, warnings, account fields, safety guidance, and usage forecasts. Choose a suggested question or type your own.";
  }

  return "I can help with almost any electricity-bill question: bill analysis, units, OCR warnings, Tamil Nadu residential or commercial tariffs, domestic subsidy boundaries, charges, due dates, savings tips, saved history, forecasts, and safety guidance. Try asking: ‘How are my units calculated?’";
}

export function PowerSenseAssistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([openingMessage]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(2);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const submit = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setMessages((current) => [
      ...current,
      { id: nextId.current++, role: "user", text: trimmed },
      { id: nextId.current++, role: "assistant", text: answerFor(trimmed) },
    ]);
    setDraft("");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(draft);
  };

  return (
    <div className={`assistant-root ${open ? "is-open" : ""}`}>
      {open && (
        <section className="assistant-panel" role="dialog" aria-modal="false" aria-labelledby="assistant-title">
          <header className="assistant-header">
            <div className="assistant-identity">
              <span className="assistant-avatar"><Bot size={19} /></span>
              <div>
                <strong id="assistant-title">Power Sense Assistant</strong>
                <span><i /> Available in your browser</span>
              </div>
            </div>
            <button className="assistant-icon-button" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X size={18} />
            </button>
          </header>

          <div className="assistant-messages" ref={messagesRef} aria-live="polite">
            {messages.map((message) => (
              <div className={`assistant-message ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="assistant-message-mark"><Zap size={12} /></span>}
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          {messages.length === 1 && (
            <div className="assistant-suggestions" aria-label="Suggested questions">
              <span><Sparkles size={13} /> Try a topic</span>
              {quickQuestions.map((question) => (
                <button key={question} onClick={() => submit(question)}>{question}</button>
              ))}
            </div>
          )}

          <form className="assistant-composer" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="assistant-question">Ask Power Sense Assistant</label>
            <input
              id="assistant-question"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about your electricity bill…"
              autoComplete="off"
            />
            <button type="submit" aria-label="Send question" disabled={!draft.trim()}><Send size={16} /></button>
          </form>
          <p className="assistant-disclaimer">Guidance only. Verify final charges against the official bill.</p>
        </section>
      )}

      {!open && (
        <button className="assistant-launcher" onClick={() => setOpen(true)} aria-label="Open Power Sense Assistant">
          <MessageCircle size={19} />
          <span>Ask Power Sense</span>
          <ChevronDown size={15} className="assistant-launcher-chevron" />
        </button>
      )}
    </div>
  );
}
