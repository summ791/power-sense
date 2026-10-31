import { FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, FileText, MessageCircle, Plus, Send, X, Zap } from "lucide-react";
import { supabase } from "../services/supabase";
import { estimateTamilNaduBill, inferTamilNaduBillingCycle, normaliseTamilNaduCategory } from "../services/tariff";

type ChatMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

type ApiMessage = { role: "assistant" | "user"; content: string };
export type AssistantBillContextStatus = "signed-out" | "loading" | "ready" | "error";
type PowerSenseAssistantProps = {
  hasSavedBills?: boolean;
  billContextStatus?: AssistantBillContextStatus;
};

const inlineMarkdownToken = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|(?<!\*)\*[^*]+\*(?!\*)|(?<!_)_[^_]+_(?!_))/g;

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(inlineMarkdownToken).filter(Boolean).map((part, index) => {
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export function renderAssistantText(markdown: string): ReactNode[] {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  const content: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) { index += 1; continue; }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      content.push(<h3 key={`heading-${index}`}>{renderInlineMarkdown(heading[1])}</h3>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      content.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      content.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index] && !/^#{1,3}\s+/.test(lines[index]) && !/^[-*]\s+/.test(lines[index]) && !/^\d+[.)]\s+/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    content.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(paragraph.join(" "))}</p>);
  }
  return content;
}

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
  text: "Hi! Ask me about your bill, units, Tamil Nadu tariffs, or saving electricity.",
};

export function answerForCalculation(question: string): string | null {
  const text = question.toLowerCase().trim();
  const readingMatch = text.match(/(?:previous|opening|from)\D*(\d+(?:\.\d+)?)\D+(?:current|present|to)\D*(\d+(?:\.\d+)?)/);
  if (readingMatch && !/\b(estimate|bill|amount|cost|price|payable)\b/.test(text)) {
    const previous = Number(readingMatch[1]);
    const current = Number(readingMatch[2]);
    const units = current - previous;
    return units >= 0
      ? `Units used: ${current.toLocaleString("en-IN")} − ${previous.toLocaleString("en-IN")} = ${units.toLocaleString("en-IN")} kWh.`
      : `The readings give a negative difference (${units.toLocaleString("en-IN")} kWh). Check their order or whether the meter rolled over.`;
  }
  const unitsMatch = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:units?|kwh)/);
  if (unitsMatch && /\b(estimate|calculate|amount|cost|price|payable)\b/.test(text)) {
    const units = Number(unitsMatch[1].replace(/,/g, ""));
    const category = normaliseTamilNaduCategory(text);
    const cycle = inferTamilNaduBillingCycle(text);
    const loadMatch = text.match(/(\d+(?:\.\d+)?)\s*kw/);
    const estimate = estimateTamilNaduBill(units, category, {
      billingCycle: cycle,
      connectedLoadKw: loadMatch ? Number(loadMatch[1]) : undefined,
    });
    const assumed = /commercial|general purpose|tariff v|lt[- ]?v|shop|office|business|residential|domestic|tariff a|lt[- ]?ia/.test(text) ? "" : " (assuming residential)";
    const subsidy = estimate.freeUnits > 0 ? ` ${estimate.freeUnits} free units; ${estimate.payableUnits} payable.` : category === "commercial" ? " No domestic subsidy applies." : "";
    return `Estimated bill: ₹${Math.round(estimate.total).toLocaleString("en-IN")} for ${units.toLocaleString("en-IN")} units, ${cycle}${assumed}.${subsidy} Actual bill may vary.`;
  }
  return null;
}

function formatApiMessages(messages: ChatMessage[]): ApiMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-8)
    .map(({ role, text }) => ({ role, content: text }));
}

export function isPersonalBillQuestion(text: string) {
  const personal = /\b(my|mine|our|saved|uploaded|in my account)\b/i.test(text);
  const comparison = /\b(last|latest|recent|previous|average|compare|compared|historical|history)\b/i.test(text)
    && /\b(bill|bills|usage|consumption|units|kwh|total|amount|charges|payment|paid|pay|spend|reading|month)\b/i.test(text);
  return personal || comparison;
}

function asksAboutOwnBills(messages: ChatMessage[]) {
  return messages.some((message) => message.role === "user" && isPersonalBillQuestion(message.text));
}

export function PowerSenseAssistant({ hasSavedBills = false, billContextStatus = "signed-out" }: PowerSenseAssistantProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([openingMessage]);
  const [isSending, setIsSending] = useState(false);
  const [useSavedBills, setUseSavedBills] = useState(true);
  const [largeText, setLargeText] = useState(false);
  const canUseBillContext = billContextStatus === "ready" && hasSavedBills;
  const billContextEnabled = canUseBillContext && useSavedBills;
  const messagesRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(2);
  const conversationVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const startNewChat = () => {
    conversationVersion.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setMessages([openingMessage]);
    setDraft("");
    setIsSending(false);
    nextId.current = 2;
  };

  const submit = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = { id: nextId.current++, role: "user", text: trimmed };
    const userAndHistory = [...messages, userMessage];
    setMessages(userAndHistory);
    setDraft("");

    const deterministicAnswer = answerForCalculation(trimmed);
    if (deterministicAnswer) {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: deterministicAnswer }]);
      return;
    }

    const replyId = nextId.current++;
    const requestVersion = conversationVersion.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setIsSending(true);
    setMessages((current) => [...current, { id: replyId, role: "assistant", text: "Thinking…" }]);

    const hasBillFocusedTurn = asksAboutOwnBills(userAndHistory);
    const includeBillContext = billContextEnabled && hasBillFocusedTurn;
    try {
      let accessToken: string | undefined;
      if (includeBillContext) {
        if (!supabase) throw new Error("Secure access to your saved bills is unavailable. Please try again later.");
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session?.access_token) throw new Error("Your account session expired. Sign in again to ask about saved bills.");
        accessToken = data.session.access_token;
      }
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          messages: formatApiMessages(userAndHistory),
          includeBillContext,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as { reply?: unknown; error?: unknown };
      if (!response.ok) {
        const message = typeof payload.error === "string" ? payload.error : "The assistant could not answer just now. Please try again.";
        throw new Error(message);
      }
      const reply = typeof payload.reply === "string" && payload.reply.trim()
        ? payload.reply.trim()
        : "The AI service returned an empty answer. Please try again.";
      if (conversationVersion.current === requestVersion) {
        setMessages((current) => current.map((message) => message.id === replyId ? { ...message, text: reply } : message));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "The assistant could not connect. Please try again.";
      if (conversationVersion.current === requestVersion) {
        setMessages((current) => current.map((item) => item.id === replyId ? { ...item, text: message } : item));
      }
    } finally {
      if (conversationVersion.current === requestVersion) {
        activeRequest.current = null;
        setIsSending(false);
      }
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit(draft);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(draft);
    }
  };

  return (
    <div className={`assistant-root ${open ? "is-open" : ""}`}>
      {open && (
        <section className={`assistant-panel ${largeText ? "assistant-large-text" : ""}`} role="dialog" aria-modal="false" aria-labelledby="assistant-title">
          <header className="assistant-header">
            <div className="assistant-identity">
              <div className="assistant-avatar" aria-hidden="true"><Bot size={21} strokeWidth={2.2} /></div>
              <div>
                <strong id="assistant-title">Power Sense Assistant</strong>
                <span><i /> AI-powered · Nemotron free route</span>
              </div>
            </div>
            <div className="assistant-header-actions">
              <button
                className={`assistant-bills-toggle ${billContextEnabled ? "is-on" : ""}`}
                type="button"
                onClick={() => {
                  const next = !useSavedBills;
                  setUseSavedBills(next);
                  if (!next) startNewChat();
                }}
                disabled={!canUseBillContext || isSending}
                aria-label={billContextEnabled ? "Turn off saved bill context" : "Turn on saved bill context"}
                aria-pressed={billContextEnabled}
                title={billContextStatus === "signed-out"
                  ? "Sign in and save bills to personalize answers"
                  : billContextStatus === "loading"
                    ? "Loading your saved bills"
                    : billContextStatus === "error"
                      ? "Saved bills are unavailable right now"
                      : canUseBillContext
                        ? billContextEnabled ? "Saved-bill context is on" : "Saved-bill context is off"
                        : "Save a bill to enable personalized answers"}
              >
                <FileText size={14} />
                <span>Bills</span>
                <i aria-hidden="true" />
              </button>
              <button
                className={`assistant-accessibility-toggle ${largeText ? "is-on" : ""}`}
                type="button"
                onClick={() => setLargeText((enabled) => !enabled)}
                aria-label={largeText ? "Use standard assistant text size" : "Increase assistant text size"}
                aria-pressed={largeText}
                title={largeText ? "Use standard text size" : "Increase text size"}
              >
                A+
              </button>
              <button className="assistant-new-chat" onClick={startNewChat} aria-label="Start a new chat">
                <Plus size={14} />
                <span>New chat</span>
              </button>
              <button className="assistant-icon-button" onClick={() => setOpen(false)} aria-label="Close assistant">
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="assistant-messages" ref={messagesRef} aria-live="polite">
            {messages.map((message) => (
              <div className={`assistant-message ${message.role}`} key={message.id}>
                {message.role === "assistant" ? (
                  <>
                    <span className="assistant-message-mark" aria-hidden="true"><Zap size={12} /></span>
                    <div className="assistant-message-content">{renderAssistantText(message.text)}</div>
                  </>
                ) : (
                  <p>{message.text}</p>
                )}
              </div>
            ))}
          </div>

          {messages.length === 1 && (
            <div className="assistant-suggestions" aria-label="Suggested questions">
              <span>Try a topic</span>
              {quickQuestions.map((question) => (
                <button key={question} onClick={() => void submit(question)} disabled={isSending}>{question}</button>
              ))}
            </div>
          )}

          <form className="assistant-composer" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="assistant-question">Ask Power Sense Assistant. Enter sends; Shift plus Enter adds a new line.</label>
            <textarea
              id="assistant-question"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={isSending ? "Waiting for the assistant…" : "Ask a question… (Shift+Enter for a new line)"}
              autoComplete="off"
              maxLength={8000}
              disabled={isSending}
              aria-describedby="assistant-compose-hint"
            />
            <button type="submit" aria-label="Send question" disabled={!draft.trim() || isSending}><Send size={16} /></button>
          </form>
          <p id="assistant-compose-hint" className="assistant-compose-hint">Long questions are welcome · {draft.length.toLocaleString("en-IN")}/8,000 · Enter to send · Shift+Enter for new line</p>
          <p className="assistant-disclaimer">
            Chats aren’t saved by Power Sense. OpenRouter may log prompts. {billContextEnabled
              ? "For questions about your bills, Power Sense securely reads up to 12 of your own saved summaries under your account permissions. Only billing month, tariff category, units and charges are shared with the AI; names, account IDs, meter IDs and files are excluded. Turn Bills off to disable that context."
              : billContextStatus === "signed-out"
                ? "Sign in and save bills to enable personalized bill answers."
                : "Saved bill context is off or unavailable; the assistant answers from your question only."} Verify charges against your official bill.
          </p>
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
