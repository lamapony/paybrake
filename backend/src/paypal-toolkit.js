// @paypal/agent-toolkit@1.11.0 is not imported: create_order has no payee, currencyCode is USD only,
// and the package pulls ai, openai, langchain, axios, and the server SDK. Tool calls run through rest.
// Swap in the real client once a payee is accepted, or if USD-only is acceptable:
// new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions: { orders: { create: true, get: true, capture: true } }, context: { sandbox: true } } })
import { createRestPort } from "./paypal-rest.js";
import { assertSandbox } from "./paypal.js";

const CURRENCIES = ["DKK", "EUR", "USD"];

const orderItem = {
  type: "object",
  properties: {
    name: { type: "string" },
    quantity: { type: "number" },
    description: { type: "string" },
    itemCost: { type: "number" },
    taxPercent: { type: "number" },
    itemTotal: { type: "number" }
  },
  required: ["name", "quantity", "itemCost", "taxPercent", "itemTotal"]
};

export const TOOLKIT_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_order",
      description: "Create a PayPal sandbox order. payeeEmail and currencyCode DKK/EUR are PayBrake extensions; the published toolkit schema is USD only and has no payee.",
      parameters: {
        type: "object",
        properties: {
          currencyCode: {
            type: "string",
            enum: CURRENCIES,
            description: "PayBrake extension. The published toolkit enum is USD only."
          },
          items: { type: "array", items: orderItem },
          discount: { type: "number" },
          shippingCost: { type: "number" },
          shippingAddress: { type: "object" },
          notes: { type: "string" },
          returnUrl: { type: "string" },
          cancelUrl: { type: "string" },
          payeeEmail: {
            type: "string",
            description: "PayBrake extension. The published create_order schema has no payee field."
          },
          referenceId: { type: "string" }
        },
        required: ["currencyCode", "items"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_order",
      description: "Get a PayPal order by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "pay_order",
      description: "Capture a PayPal order by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      }
    }
  }
];

function bad(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "bad_request";
  throw error;
}

function lineValue(item) {
  if (!item || typeof item !== "object") return NaN;
  if (item.itemTotal != null && item.itemTotal !== "") return Number(item.itemTotal);
  const qty = item.quantity == null || item.quantity === "" ? 1 : Number(item.quantity);
  return Number(item.itemCost) * qty;
}

function extra(value) {
  if (value == null || value === "") return 0;
  return Number(value);
}

export function toolkitArgsToOrder(args = {}) {
  const items = Array.isArray(args.items) ? args.items : [];
  const name = items[0] && items[0].name != null ? String(items[0].name).trim() : "";
  if (!name) bad("items[0].name is required");
  let sum = 0;
  for (const item of items) {
    const line = lineValue(item);
    if (!Number.isFinite(line)) bad("item amount is invalid");
    sum += line;
  }
  const shipping = extra(args.shippingCost);
  const discount = extra(args.discount);
  if (!Number.isFinite(shipping) || !Number.isFinite(discount)) bad("amount is invalid");
  const amount = Math.round((sum + shipping - discount) * 100) / 100;
  if (!Number.isFinite(amount)) bad("amount is invalid");
  return {
    item: name,
    amount,
    currency: String(args.currencyCode ?? "").trim().toUpperCase(),
    payeeEmail: args.payeeEmail ? String(args.payeeEmail).trim() : "",
    referenceId: args.referenceId ? String(args.referenceId) : undefined
  };
}

export function createToolkitPort(env = {}, deps = {}) {
  assertSandbox(env);
  const rest = createRestPort(env, deps);

  async function runTool(name, args) {
    if (name === "create_order") return rest.createOrder(toolkitArgsToOrder(args || {}));
    if (name === "get_order") return rest.getOrder(args && args.id);
    if (name === "pay_order") return rest.captureOrder(args && args.id);
    bad("unknown tool");
  }

  return {
    mode: "toolkit",
    tools: TOOLKIT_TOOLS,
    runTool,
    createOrder: (order) => rest.createOrder(order),
    getOrder: (id) => rest.getOrder(id),
    captureOrder: (id) => rest.captureOrder(id)
  };
}
