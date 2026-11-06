"use client";

// Module 2: the Ask Copper chat panel. A floating launcher opens a side
// sheet; each answer is drawn as a rail of "stations" (the tools on offer,
// Copper's thinking, each tool call, what's happening now) followed by the
// reply. Tools on and tools off are two separate conversations.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  ArrowUpIcon,
  BrainIcon,
  MessageCircleIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { SetupRequired } from "@/components/setup-required";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import {
  TOOL_LABELS,
  type Progress,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import { formatUsd, getPlans, getProducts } from "@/lib/copper/catalog";
import { cn } from "@/lib/utils";

export const STARTER_QUESTIONS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

type Mode = "on" | "off";
type Turn = { id: number; question: string; answer: Progress };

const WORKING: Progress = { steps: [], reply: "", status: "working" };

const isAskLink = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest('a[href$="#ask"]'));

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Record<Mode, Turn[]>>({ on: [], off: [] });
  const [draft, setDraft] = useState("");
  const nextId = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const mode: Mode = useTools ? "on" : "off";
  const turns = chats[mode];
  const busy = turns.at(-1)?.answer.status === "working";

  // Open from /#ask, from a later hash change, or from any link to #ask (a
  // second click on the same link fires no hashchange).
  useEffect(() => {
    const openIfAsk = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      if (isAskLink(event.target)) setOpen(true);
    };
    openIfAsk();
    window.addEventListener("hashchange", openIfAsk);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", openIfAsk);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // Keep the newest step in view.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [turns]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next && window.location.hash === "#ask") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  function setAnswer(key: Mode, id: number, answer: Progress) {
    setChats((current) => ({
      ...current,
      [key]: current[key].map((turn) =>
        turn.id === id ? { ...turn, answer } : turn,
      ),
    }));
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const key = mode;
    const id = nextId.current++;
    // Only this conversation's history: the shopper's questions and Copper's
    // finished replies, no steps.
    const messages: ChatMessage[] = [
      ...chats[key].flatMap((turn): ChatMessage[] => [
        { role: "user", content: turn.question },
        ...(turn.answer.reply
          ? [{ role: "assistant" as const, content: turn.answer.reply }]
          : []),
      ]),
      { role: "user", content: text },
    ];
    setDraft("");
    setChats((current) => ({
      ...current,
      [key]: [...current[key], { id, question: text, answer: WORKING }],
    }));

    try {
      const { progress } = await askCopper({
        messages,
        useTools: key === "on",
      });
      for await (const update of readLive(progress)) setAnswer(key, id, update);
    } catch {
      setAnswer(key, id, {
        steps: [],
        reply: "Sorry, I couldn't reach Copper just now. Please try again.",
        status: "error",
      });
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="ask-copper-launcher"
        onClick={() => setOpen(true)}
        className="bg-primary text-primary-foreground focus-visible:ring-ring/50 fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full px-5 py-3 font-semibold shadow-lg transition-transform outline-none hover:scale-105 focus-visible:ring-3"
      >
        <MessageCircleIcon className="size-5" aria-hidden />
        Ask Copper
      </button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-testid="ask-copper"
          side="right"
          showCloseButton={false}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <PanelHeader
            useTools={useTools}
            onUseToolsChange={setUseTools}
            showToggle={aiConfigured}
          />

          {aiConfigured ? (
            <>
              <div
                ref={bodyRef}
                className="bg-secondary text-secondary-foreground flex-1 overflow-y-auto px-4 py-5"
              >
                <div className="flex flex-col gap-6">
                  {turns.length === 0 && (
                    <p className="text-muted-foreground text-center text-sm">
                      {useTools
                        ? "Ask about prices, totals or stock. Copper checks every answer with its tools."
                        : "Tools are off: Copper will answer from memory alone."}
                    </p>
                  )}
                  {turns.map((turn) => (
                    <div key={turn.id} className="flex flex-col gap-4">
                      <div className="bg-primary text-primary-foreground ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2 font-medium">
                        {turn.question}
                      </div>
                      <Answer answer={turn.answer} useTools={mode === "on"} />
                    </div>
                  ))}
                  {!busy && (
                    <div className="flex flex-col gap-2">
                      <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
                        {turns.length === 0 ? "Try asking" : "Ask another"}
                      </p>
                      {STARTER_QUESTIONS.map((starter) => (
                        <button
                          key={starter}
                          type="button"
                          onClick={() => ask(starter)}
                          className="bg-background hover:border-primary rounded-xl border px-3 py-2 text-left text-sm transition-colors"
                        >
                          {starter}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask(draft);
                }}
                className="bg-background flex items-center gap-2 border-t p-3"
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  aria-label="Your question"
                  placeholder="Ask about prices, totals or stock…"
                  className="bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 flex-1 rounded-full border px-4 text-base outline-none focus-visible:ring-3 sm:text-sm"
                />
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={busy}
                  className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-50"
                >
                  <ArrowUpIcon className="size-5" aria-hidden />
                </button>
              </form>
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto px-4">
              <SetupRequired service="ai" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function PanelHeader({
  useTools,
  onUseToolsChange,
  showToggle,
}: {
  useTools: boolean;
  onUseToolsChange: (value: boolean) => void;
  showToggle: boolean;
}) {
  // The `dark` class makes the header Night Sky in both themes.
  return (
    <div className="dark">
      <div className="bg-background text-foreground">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="bg-primary flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <Image
              src="/assets/brand/copper-mascot.png"
              alt="Copper the robot mascot"
              width={88}
              height={88}
              className="size-10"
            />
          </span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg font-bold">Ask Copper</SheetTitle>
            <SheetDescription>
              Prices, totals and stock, checked with tools.
            </SheetDescription>
          </div>
          <SheetClose className="hover:bg-muted rounded-md p-1.5 transition-colors">
            <XIcon className="size-5" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>
        {showToggle && (
          <div className="flex items-center gap-3 bg-white/5 px-4 py-2.5">
            <div className="flex-1">
              <p className="text-sm font-semibold">Use tools</p>
              <p className="text-muted-foreground text-xs">
                {useTools ? "Checks every answer" : "Model guesses alone"}
              </p>
            </div>
            <Switch
              aria-label="Use tools"
              checked={useTools}
              onCheckedChange={onUseToolsChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One answer: the rail of stations, then the reply
// ---------------------------------------------------------------------------

function Answer({ answer, useTools }: { answer: Progress; useTools: boolean }) {
  const working = answer.status === "working";
  const used = new Set(
    answer.steps
      .filter((s): s is ToolStep => s.type === "tool")
      .map((s) => s.name),
  );
  let toolNumber = 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex flex-col gap-5 pl-10">
        <div
          aria-hidden
          className={cn(
            "absolute top-3 bottom-3 left-[15px] w-0.5 rounded-full",
            useTools
              ? "from-primary via-accent to-accent bg-linear-to-b"
              : "bg-chart-3",
          )}
        />
        <Station
          node={<WrenchIcon className="size-3.5" />}
          nodeClass={
            useTools
              ? "bg-accent text-accent-foreground"
              : "bg-muted text-muted-foreground"
          }
          label={
            useTools ? "Tools Copper can use" : "Tools given to Copper: none"
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(TOOL_LABELS).map((name) => (
              <span
                key={name}
                className={cn(
                  "rounded-md px-2 py-0.5 font-mono text-xs",
                  !useTools && "bg-muted text-muted-foreground line-through",
                  useTools &&
                    used.has(name) &&
                    "bg-accent text-accent-foreground font-bold",
                  useTools &&
                    !used.has(name) &&
                    "bg-muted text-muted-foreground",
                )}
              >
                {name}
              </span>
            ))}
          </div>
          {!useTools && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Copper has to answer from memory alone.
            </p>
          )}
        </Station>

        {answer.steps.map((step, i) =>
          step.type === "thinking" ? (
            <Station
              key={`thinking-${i}`}
              node={<BrainIcon className="size-3.5" />}
              nodeClass={
                useTools
                  ? "bg-primary text-primary-foreground"
                  : "bg-chart-3 text-primary-foreground"
              }
              label="Copper is thinking"
            >
              <div
                data-testid="thinking"
                className="text-muted-foreground border-l-2 pl-3 text-sm italic"
              >
                <InlineMarkdown text={step.text} />
              </div>
            </Station>
          ) : (
            <Station
              key={step.id}
              node={<WrenchIcon className="size-3.5" />}
              nodeClass="bg-accent text-accent-foreground"
              label={
                step.state === "calling"
                  ? "Copper is calling a tool"
                  : "Copper called a tool"
              }
            >
              <ToolCard step={step} number={++toolNumber} />
            </Station>
          ),
        )}

        {working && (
          <Station
            node={
              <span className="flex gap-0.5">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="size-1 animate-bounce rounded-full bg-current"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            }
            nodeClass="bg-background text-foreground animate-pulse"
          >
            <p className="text-muted-foreground pt-1 text-sm">
              {nowText(answer, useTools)}
            </p>
          </Station>
        )}
      </div>

      {answer.reply && (
        <div className="bg-card text-card-foreground mr-4 rounded-2xl rounded-tl-sm border px-4 py-3 shadow-sm">
          <p className="text-primary mb-1 text-xs font-bold tracking-wide">
            Copper
          </p>
          {!useTools && (
            <div className="border-chart-3 bg-chart-3/10 mb-3 rounded-lg border p-3 text-sm">
              <p className="flex items-center gap-1.5 font-semibold">
                <TriangleAlertIcon
                  className="text-chart-3 size-4"
                  aria-hidden
                />
                Answered without tools: may be made up
              </p>
              <p className="text-muted-foreground mt-1">
                With tools off, Copper can&apos;t see today&apos;s prices or
                stock. The AI only has what it learned in training, so it fills
                the gaps with guesses that sound right. That&apos;s a
                hallucination.
              </p>
            </div>
          )}
          <p className="text-sm whitespace-pre-wrap">
            {answer.reply}
            {working && (
              <span
                aria-hidden
                className="bg-primary ml-0.5 inline-block h-4 w-0.5 animate-pulse align-text-bottom"
              />
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function nowText(answer: Progress, useTools: boolean) {
  if (answer.reply) return "Writing the answer…";
  if (!useTools) return "Answering from memory…";
  if (answer.steps.length > 0) return "Deciding what to do next…";
  return "Reading your question…";
}

function Station({
  node,
  nodeClass,
  label,
  children,
}: {
  node: ReactNode;
  nodeClass: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span
        className={cn(
          "ring-secondary absolute top-0 -left-10 flex size-8 items-center justify-center rounded-full ring-4",
          nodeClass,
        )}
      >
        {node}
      </span>
      {label && (
        <p className="text-muted-foreground mb-2 pt-1.5 text-[11px] font-semibold tracking-widest uppercase">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

/** Renders the **bold** and `code` marks in Gemini's thought summaries. */
function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((piece, i) => {
        if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4)
          return (
            <strong
              key={i}
              className="text-foreground block font-semibold not-italic"
            >
              {piece.slice(2, -2)}
            </strong>
          );
        if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2)
          return (
            <code
              key={i}
              className="bg-background rounded px-1 font-mono text-xs not-italic"
            >
              {piece.slice(1, -1)}
            </code>
          );
        return <span key={i}>{piece}</span>;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// The tool card: what Copper sent, and what came back
// ---------------------------------------------------------------------------

const productName = (id: unknown) =>
  getProducts().find((p) => p.id === id)?.name ?? String(id);
const planName = (id: unknown) =>
  getPlans().find((p) => p.id === id)?.name ?? String(id);

type Row = [label: string, value: string];

function sentRows(name: string, input: unknown): Row[] | string {
  if (name === "get_prices") return "Nothing, it just asked for the price list";
  if (name === "get_products")
    return "Nothing, it just asked what Copper sells";
  const value = (input ?? {}) as Record<string, unknown>;
  if (name === "calculate_cost") {
    const products = Array.isArray(value.products) ? value.products : [];
    return [
      [
        "Products",
        products.length ? products.map(productName).join(", ") : "None",
      ],
      ["Plan", planName(value.plan)],
      ["Billing", String(value.billing ?? "")],
      ["Years", String(value.years ?? "")],
    ];
  }
  if (name === "compare_billing") {
    return [["Years", String(value.years ?? "")]];
  }
  if (name === "check_availability") {
    return [
      ["Product", productName(value.product)],
      ["Color", typeof value.color === "string" ? value.color : "Every color"],
    ];
  }
  return Object.entries(value).map(([k, v]) => [k, String(v)]);
}

function ToolCard({ step, number }: { step: ToolStep; number: number }) {
  const calling = step.state === "calling";
  const sent =
    step.input === undefined ? null : sentRows(step.name, step.input);

  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="bg-card text-card-foreground overflow-hidden rounded-xl border shadow-sm"
    >
      <div className="bg-accent text-accent-foreground flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="font-mono text-sm font-bold">{step.name}()</span>
        <span className="bg-background/30 rounded px-1.5 text-[10px] font-semibold">
          tool {number}
        </span>
        <span className="ml-auto text-xs font-medium">
          {TOOL_LABELS[step.name] ?? ""}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-widest uppercase">
          → What Copper sent
        </p>
        {sent === null ? (
          <p className="text-muted-foreground text-sm italic">
            filling in the details…
          </p>
        ) : typeof sent === "string" ? (
          <p className="text-sm">{sent}</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
            {sent.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="bg-accent/10 border-t px-3 py-2.5">
        <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-widest uppercase">
          ← What came back
        </p>
        {calling ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner className="size-3.5" />
            the app is running the code…
          </p>
        ) : step.state === "error" ? (
          <p className="text-chart-3 text-sm">{String(step.output)}</p>
        ) : (
          <ToolOutput name={step.name} output={step.output} />
        )}
      </div>
    </div>
  );
}

type CostOutput = { lines: { item: string; usd: number }[]; totalUsd: number };
type ProductsOutput = {
  products: {
    id: string;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};
type PricesOutput = {
  products: { id: string; name: string; priceUsd: number }[];
  plans: { id: string; name: string; monthlyUsd: number; annualUsd: number }[];
};
type BillingOutput = {
  years: number;
  monthly: { perMonthUsd: number; totalUsd: number };
  annual: { perYearUsd: number; totalUsd: number };
  cheaper: "monthly" | "annual" | "same";
  savingsUsd: number;
};
type AvailabilityOutput =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: string; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

function ToolOutput({ name, output }: { name: string; output: unknown }) {
  if (
    name === "calculate_cost" &&
    isObject(output) &&
    Array.isArray(output.lines)
  ) {
    const cost = output as CostOutput;
    return (
      <div className="text-sm">
        {cost.lines.map((line) => (
          <div key={line.item} className="flex justify-between gap-4 py-0.5">
            <span>{line.item}</span>
            <span className="font-medium tabular-nums">
              {formatUsd(line.usd)}
            </span>
          </div>
        ))}
        <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t pt-1.5">
          <span className="font-semibold">Total</span>
          <span className="text-primary text-xl font-bold tabular-nums">
            {formatUsd(cost.totalUsd)}
          </span>
        </div>
      </div>
    );
  }

  if (
    name === "get_products" &&
    isObject(output) &&
    Array.isArray(output.products)
  ) {
    return (
      <div className="flex flex-col gap-2.5 text-sm">
        {(output as ProductsOutput).products.map((product) => (
          <div key={product.id}>
            <div className="flex justify-between gap-4">
              <span className="font-semibold">{product.name}</span>
              <span className="font-medium tabular-nums">
                {formatUsd(product.priceUsd)}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">{product.type}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {product.colors.map((color) => (
                <span
                  key={color}
                  className="bg-accent/20 rounded-full px-2 py-0.5 text-[11px]"
                >
                  {color}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (
    name === "get_prices" &&
    isObject(output) &&
    Array.isArray(output.products)
  ) {
    const prices = output as PricesOutput;
    return (
      <div className="text-sm">
        {prices.products.map((product) => (
          <div key={product.id} className="flex justify-between gap-4 py-0.5">
            <span>{product.name}</span>
            <span className="font-medium tabular-nums">
              {formatUsd(product.priceUsd)}
            </span>
          </div>
        ))}
        {prices.plans
          .filter((plan) => plan.monthlyUsd > 0 || plan.annualUsd > 0)
          .map((plan) => (
            <div key={plan.id} className="flex justify-between gap-4 py-0.5">
              <span>{plan.name}</span>
              <span className="font-medium tabular-nums">
                {formatUsd(plan.monthlyUsd)}/mo · {formatUsd(plan.annualUsd)}/yr
              </span>
            </div>
          ))}
      </div>
    );
  }

  if (
    name === "compare_billing" &&
    isObject(output) &&
    isObject(output.monthly)
  ) {
    const billing = output as BillingOutput;
    const years = billing.years === 1 ? "1 year" : `${billing.years} years`;
    return (
      <div className="text-sm">
        <div className="flex justify-between gap-4 py-0.5">
          <span>
            Monthly ({formatUsd(billing.monthly.perMonthUsd)}/mo), {years}
          </span>
          <span className="font-medium tabular-nums">
            {formatUsd(billing.monthly.totalUsd)}
          </span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span>
            Yearly ({formatUsd(billing.annual.perYearUsd)}/yr), {years}
          </span>
          <span className="font-medium tabular-nums">
            {formatUsd(billing.annual.totalUsd)}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t pt-1.5">
          <span className="font-semibold">
            {billing.cheaper === "same"
              ? "Same price either way"
              : `${billing.cheaper === "annual" ? "Yearly" : "Monthly"} saves`}
          </span>
          {billing.cheaper !== "same" && (
            <span className="text-primary text-xl font-bold tabular-nums">
              {formatUsd(billing.savingsUsd)}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (name === "check_availability" && isObject(output) && "status" in output) {
    const result = output as AvailabilityOutput;
    if (result.status === "unavailable")
      return <p className="text-sm">{result.message}</p>;
    if (result.status === "not_a_color")
      return (
        <p className="text-sm">
          {result.product} doesn&apos;t come in {result.color}. It comes in{" "}
          {listOf(result.colors)}.
        </p>
      );
    return (
      <div className="text-sm">
        {result.colors.length === 0 && (
          <p className="text-muted-foreground">
            No stock rows for {result.product}.
          </p>
        )}
        {result.colors.map((entry) => (
          <div
            key={entry.color}
            className="flex items-center justify-between gap-4 py-0.5"
          >
            <span>{entry.color}</span>
            <StockPill stock={entry.stock} restockDate={entry.restockDate} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <p className="text-muted-foreground text-sm">
      {output === undefined
        ? "Nothing came back."
        : String(JSON.stringify(output))}
    </p>
  );
}

function StockPill({
  stock,
  restockDate,
}: {
  stock: string;
  restockDate: string | null;
}) {
  const [label, className] =
    stock === "in_stock"
      ? ["In stock", "bg-accent text-accent-foreground"]
      : stock === "low_stock"
        ? ["Low stock", "bg-chart-4 text-primary-foreground"]
        : [
            restockDate
              ? `Back-ordered until ${formatDate(restockDate)}`
              : "Back-ordered",
            "bg-chart-3 text-primary-foreground",
          ];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-semibold",
        className,
      )}
    >
      {label}
    </span>
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function listOf(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "2026-11-14" → "Nov 14, 2026" (read as a calendar date, not a time). */
function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
