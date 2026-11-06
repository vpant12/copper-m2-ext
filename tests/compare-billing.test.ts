// Extension: compare_billing, the fifth Ask Copper tool. It compares paying
// for Copper Plus monthly with paying yearly, using catalog prices.
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finalValue } from "@/lib/ai/live";

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => model,
}));

async function loadTools() {
  vi.resetModules();
  return import("@/lib/copper/assistant/tools");
}

afterEach(() => {
  vi.doUnmock("@/lib/copper/catalog");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("compare_billing", () => {
  it("compares Copper Plus monthly and yearly over 1 year", async () => {
    const { compareBilling } = await loadTools();
    expect(compareBilling({ years: 1 })).toEqual({
      plan: "Copper Plus",
      years: 1,
      monthly: { perMonthUsd: 7.99, totalUsd: 95.88 },
      annual: { perYearUsd: 79, totalUsd: 79 },
      cheaper: "annual",
      savingsUsd: 16.88,
      savingsPercent: 18,
    });
  });

  it("adds up several years", async () => {
    const { compareBilling } = await loadTools();
    const result = compareBilling({ years: 3 });
    expect(result.monthly.totalUsd).toBe(287.64);
    expect(result.annual.totalUsd).toBe(237);
    expect(result.savingsUsd).toBe(50.64);
    expect(result.cheaper).toBe("annual");
  });

  it("follows the catalog when prices change", async () => {
    vi.doMock("@/lib/copper/catalog", async (importOriginal) => {
      const real =
        await importOriginal<typeof import("@/lib/copper/catalog")>();
      return {
        ...real,
        getPlans: () =>
          real
            .getPlans()
            .map((p) =>
              p.id === "copper-plus"
                ? { ...p, monthlyUsd: 5, annualUsd: 70 }
                : p,
            ),
      };
    });
    const { compareBilling } = await loadTools();
    // $5 x 12 = $60 a year, so monthly is now the cheaper way to pay.
    expect(compareBilling({ years: 1 })).toMatchObject({
      monthly: { totalUsd: 60 },
      annual: { totalUsd: 70 },
      cheaper: "monthly",
      savingsUsd: 10,
    });
  });

  it("rejects input outside its contract", async () => {
    const { compareBillingInput } = await loadTools();
    expect(compareBillingInput.safeParse({ years: 2 }).success).toBe(true);
    for (const input of [
      {},
      { years: 0 },
      { years: 6 },
      { years: 1.5 },
      { years: "2" },
    ]) {
      expect(
        compareBillingInput.safeParse(input).success,
        JSON.stringify(input),
      ).toBe(false);
    }
  });

  it("is a described tool that the model is offered alongside the other four", async () => {
    const { extensionTools, copperTools } = await loadTools();
    expect(extensionTools.compare_billing.description).toMatch(
      /monthly.+yearly/i,
    );
    expect(Object.keys(copperTools)).not.toContain("compare_billing");

    model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Yearly is cheaper." },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 5, text: 5, reasoning: undefined },
            },
          },
        ]),
      }),
    });
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { askCopper } = await import("@/lib/copper/assistant/ask");
    await finalValue(
      (
        await askCopper({
          messages: [
            {
              role: "user",
              content: "Is Copper Plus cheaper monthly or yearly?",
            },
          ],
          useTools: true,
        })
      ).progress,
    );
    const names = (model.doStreamCalls[0].tools ?? []).map((t) => t.name);
    expect(names).toContain("compare_billing");
    expect(names).toHaveLength(5);
  });
});
