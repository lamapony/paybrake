// Classic content script and a Node ESM side-effect module. No import/export.
// One chat (the hash of its text) keeps its mock order or Pay anyway choice
// in extension storage. A reload or the approval page's return link reads it back.

function viewDeal(deal) {
  if (!deal || typeof deal !== "object") return null;
  if (deal.override === true) return { kind: "override" };
  const orderId = typeof deal.orderId === "string" ? deal.orderId : "";
  if (!orderId) return null;
  const status = typeof deal.status === "string" ? deal.status : "";
  const approveUrl = typeof deal.approveUrl === "string" ? deal.approveUrl : "";
  const mode = typeof deal.mode === "string" ? deal.mode : "";
  return {
    kind: "order",
    orderId,
    approveUrl,
    mode,
    status,
    approved: status === "APPROVED" || status === "COMPLETED",
    paid: status === "COMPLETED"
  };
}

function sessionPatch(stored) {
  if (!stored || stored.kind === "override") {
    return stored && stored.kind === "override" ? { state: "override", error: "" } : null;
  }
  if (stored.kind !== "order" || !stored.orderId) return null;
  const mode = stored.mode || "";
  const approveUrl = stored.approveUrl || "";
  if (stored.paid || stored.status === "COMPLETED") {
    return { state: "paid", orderId: stored.orderId, approveUrl, mode, approved: true, error: "" };
  }
  return {
    state: "created",
    orderId: stored.orderId,
    approveUrl,
    mode,
    approved: stored.approved === true || stored.status === "APPROVED",
    error: ""
  };
}

function withStored(response, deal) {
  const stored = viewDeal(deal);
  if (!stored) return response;
  return Object.assign({}, response, { stored });
}

// The page can read its own localStorage. Persist the order or the Pay anyway
// choice only. Chat text, the verdict, and listing context stay in memory.
function diskDeal(deal) {
  if (!deal || typeof deal !== "object") return null;
  const out = {};
  if (deal.override === true) out.override = true;
  if (typeof deal.orderId === "string" && deal.orderId) out.orderId = deal.orderId;
  if (typeof deal.approveUrl === "string" && deal.approveUrl) out.approveUrl = deal.approveUrl;
  if (typeof deal.mode === "string" && deal.mode) out.mode = deal.mode;
  if (typeof deal.status === "string" && deal.status) out.status = deal.status;
  if (!out.override && !out.orderId) return null;
  return out;
}

globalThis.pbChatState = {
  viewDeal,
  sessionPatch,
  withStored,
  diskDeal
};
