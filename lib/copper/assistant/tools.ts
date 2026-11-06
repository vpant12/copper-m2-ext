// Module 2: the four tools Ask Copper can use. Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  getPlans,
  getProducts,
  type Plan,
  type ProductId,
} from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: {
    id: Plan["id"];
    name: string;
    monthlyUsd: number;
    annualUsd: number;
  }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

const PRODUCT_IDS = ["copper-home", "copper-notes"] as const;
const PLAN_IDS = ["free", "copper-plus"] as const;

/** Under this many units, a color is low stock. */
const LOW_STOCK = 10;

const toCents = (usd: number) => Math.round(usd * 100) / 100;

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map(({ id, name, type, priceUsd, colors }) => ({
      id,
      name,
      type,
      priceUsd,
      colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map(({ id, name, priceUsd }) => ({
      id,
      name,
      priceUsd,
    })),
    plans: getPlans().map(({ id, name, monthlyUsd, annualUsd }) => ({
      id,
      name,
      monthlyUsd,
      annualUsd,
    })),
  };
}

export const calculateCostInput: z.ZodType<CalculateCostInput> = z.object({
  products: z
    .array(z.enum(PRODUCT_IDS))
    .max(5)
    .describe("The devices to buy, 0 to 5. List a device twice to buy two."),
  plan: z.enum(PLAN_IDS).describe("The plan for the household."),
  billing: z
    .enum(["monthly", "annual"])
    .describe("How the plan is paid: monthly or annual."),
  years: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("How many years to add up, a whole number from 1 to 5."),
});

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const products = getProducts();
  const lines: CostBreakdown["lines"] = [];

  // Each device is paid for once.
  for (const id of input.products) {
    const product = products.find((p) => p.id === id);
    if (!product) throw new Error(`Unknown product: ${id}`);
    lines.push({ item: product.name, usd: toCents(product.priceUsd) });
  }

  // The plan covers the whole household, so it's counted once. Free adds no line.
  const plan = getPlans().find((p) => p.id === input.plan);
  if (!plan) throw new Error(`Unknown plan: ${input.plan}`);
  const planUsd =
    input.billing === "monthly"
      ? plan.monthlyUsd * 12 * input.years
      : plan.annualUsd * input.years;
  if (planUsd > 0) {
    const years = input.years === 1 ? "1 year" : `${input.years} years`;
    lines.push({
      item: `${plan.name}, ${input.billing}, ${years}`,
      usd: toCents(planUsd),
    });
  }

  const totalUsd = toCents(lines.reduce((sum, line) => sum + line.usd, 0));
  return { lines, totalUsd };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.object({
    product: z.enum(PRODUCT_IDS).describe("The product to check."),
    color: z
      .string()
      .optional()
      .describe(
        "One color name, in any capitalization. Leave out for every color.",
      ),
  });

function stockOf(units: number): Stock {
  if (units <= 0) return "backordered";
  if (units < LOW_STOCK) return "low_stock";
  return "in_stock";
}

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product);
  if (!product) {
    return { status: "unavailable", message: "That isn't a Copper product." };
  }

  // A color the product doesn't come in is never "out of stock", so check the
  // catalog before reading stock.
  let colors = product.colors;
  if (input.color !== undefined) {
    const asked = input.color.trim().toLowerCase();
    const match = product.colors.find((c) => c.toLowerCase() === asked);
    if (!match) {
      return {
        status: "not_a_color",
        product: product.name,
        color: input.color,
        colors: product.colors,
      };
    }
    colors = [match];
  }

  // Read stock fresh every time: it changes daily.
  const rows = await readInventory();
  if (!rows) {
    return {
      status: "unavailable",
      message: "Stock can't be checked right now. Please try again later.",
    };
  }

  const productRows = rows.filter((row) => row.product === product.name);
  return {
    status: "ok",
    product: product.name,
    colors: colors.flatMap((color) => {
      const row = productRows.find(
        (r) => r.color.toLowerCase() === color.toLowerCase(),
      );
      if (!row) return [];
      const stock = stockOf(row.units_in_stock);
      return [
        {
          color,
          stock,
          restockDate: stock === "backordered" ? row.next_shipment : null,
        },
      ];
    }),
  };
}

// Extension (not part of the Module 2 spec): a fifth tool that compares paying
// for Copper Plus monthly with paying yearly.

export type CompareBillingInput = { years: number };

export type BillingComparison = {
  plan: string;
  years: number;
  monthly: { perMonthUsd: number; totalUsd: number };
  annual: { perYearUsd: number; totalUsd: number };
  cheaper: "monthly" | "annual" | "same";
  savingsUsd: number;
  savingsPercent: number;
};

export const compareBillingInput: z.ZodType<CompareBillingInput> = z.object({
  years: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("How many years to compare, a whole number from 1 to 5."),
});

/** compare_billing: Copper Plus paid monthly vs. yearly over some years. */
export function compareBilling(input: CompareBillingInput): BillingComparison {
  const plan = getPlans().find((p) => p.id === "copper-plus");
  if (!plan) throw new Error("Copper Plus isn't in the catalog");

  const monthlyTotal = toCents(plan.monthlyUsd * 12 * input.years);
  const annualTotal = toCents(plan.annualUsd * input.years);
  const savingsUsd = toCents(Math.abs(monthlyTotal - annualTotal));
  const higher = Math.max(monthlyTotal, annualTotal);

  return {
    plan: plan.name,
    years: input.years,
    monthly: { perMonthUsd: plan.monthlyUsd, totalUsd: monthlyTotal },
    annual: { perYearUsd: plan.annualUsd, totalUsd: annualTotal },
    cheaper:
      annualTotal < monthlyTotal
        ? "annual"
        : monthlyTotal < annualTotal
          ? "monthly"
          : "same",
    savingsUsd,
    savingsPercent: higher > 0 ? Math.round((savingsUsd / higher) * 100) : 0,
  };
}

/** Tools added beyond the spec's four. Kept apart so copperTools stays the spec's set. */
export const extensionTools = {
  compare_billing: tool({
    description:
      "Compares paying for Copper Plus monthly with paying yearly over 1 to 5 years, and says which is cheaper and by how much.",
    inputSchema: compareBillingInput,
    execute: async (input) => compareBilling(input),
  }),
} satisfies ToolSet;

export const copperTools = {
  get_products: tool({
    description:
      "Lists every Copper product with its type, price and the colors it comes in.",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description:
      "Gets the current price of every Copper product and every plan, monthly and annual.",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Works out the total cost of some Copper devices plus a plan, billed monthly or annually, over 1 to 5 years.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Checks today's stock for a Copper product, for every color or just one.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
} satisfies ToolSet;
