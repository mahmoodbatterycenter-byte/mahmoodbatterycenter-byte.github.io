// site/actions/fbr-rules.mjs — the shopfront's registered local site actions.
//
// This is the grounding the whole entry exists for: a compliance question is answered by
// deterministic code over a cited rule table, and the model is only allowed to relay what
// this file returns. The four read actions are thin adapters over the generated twin of
// the same handlers the Atlassian Forge app runs, so the two products cannot disagree
// about one invoice. The fifth action is deliberately a write, because spec 3.1 only lets
// you see "the runtime validates arguments and confirms before a write" if something can
// actually write.

import { RULESETS } from "./rules-table.gen.mjs";
import { editWindow, checkChannel, validateInvoice, listRules } from "./rules-core.gen.mjs";

const JURISDICTION = {
  type: "string",
  title: "Jurisdiction",
  description: 'Ruleset code. Only "PK-FBR" (Pakistan federal board of revenue) is installed. Anything else returns UNKNOWN_JURISDICTION and nothing is checked.',
};

const TEXT = (description) => ({ type: "string", description });

const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function sha256Hex(text) {
  // Subtle-Crypto is not available in every runtime; a stable short digest is enough to
  // make a receipt refer to one specific draft rather than to "something we saved".
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (text.charCodeAt(i) + i), 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).padStart(16, "0");
}

function petitionText(args) {
  const rs = RULESETS[String(args.jurisdiction || "").toUpperCase()];
  if (!rs) return null;
  const deadline = new Date(new Date(args.generatedAt).getTime() + rs.channelRules.editWindowHours * 3600 * 1000);
  return [
    `To: The Office of the Commissioner Inland Revenue, ${args.region || "[region]"}`,
    `Subject: Request for prior approval to ${args.operation || "cancel / amend"} Digital Invoicing reference ${args.invoiceRef || "[FBR DI number]"}`,
    "",
    `1. The invoice in question was generated on ${args.generatedAt}. The ${rs.channelRules.editWindowHours}-hour window`
      + ` for cancellation, deletion or amendment through the system therefore closed at ${deadline.toISOString()}.`,
    `2. Requested now: ${args.operation || "cancellation / amendment"} of ${args.invoiceRef || "the invoice"}, for this reason:`
      + ` ${args.reason}`,
    `3. We understand the position is: ${rs.channelRules.afterWindow}`,
    "",
    "Attachments: copy of the original invoice, the point-of-sale / system record, and the corrected document if applicable.",
    `Reference no. (office use): __________________    Filed: ${new Date().toISOString()}`,
  ].join("\n");
}

export async function registerActions(actions) {
  actions.register({
    name: "list_rules",
    description: "List the installed rulesets, or dump one ruleset's mandatory fields, business rules, printed-invoice obligations and continuing duties exactly as cited.",
    effect: "read",
    availability: "local-only",
    inputSchema: object({ jurisdiction: { ...JURISDICTION, description: `${JURISDICTION.description} Leave it out to ask which rulesets exist.` } }),
    execute: (args) => listRules({ jurisdiction: args.jurisdiction || "" }),
  });

  actions.register({
    name: "check_edit_window",
    description: "Compute whether an invoice can still be cancelled, deleted or edited through the FBR system right now, from its generation timestamp, and return the deadline and time left.",
    effect: "read",
    availability: "local-only",
    inputSchema: object({
      jurisdiction: JURISDICTION,
      generatedAt: TEXT("Invoice generation time, ISO 8601 with offset, e.g. 2026-11-12T09:30:00+05:00."),
    }, ["jurisdiction", "generatedAt"]),
    execute: (args) => editWindow({ jurisdiction: args.jurisdiction, generatedAt: args.generatedAt }),
  });

  actions.register({
    name: "assign_channel",
    description: "Decide whether a sale must go through POS or Digital Invoicing, and reject a payload whose buyer identifier equals the seller's.",
    effect: "read",
    availability: "local-only",
    inputSchema: object({
      jurisdiction: JURISDICTION,
      sellerNTNCNIC: TEXT("Seller NTN (NNNNNNN-D) or CNIC."),
      buyerNTNCNIC: TEXT("Buyer NTN or CNIC. Empty for an unregistered retail buyer."),
      buyerRegistrationType: TEXT("As the buyer is registered, e.g. Registered, Unregistered, Not Applicable."),
      invoiceType: { type: "string", description: "Sale Invoice or Debit Note. Defaults to Sale Invoice." },
    }, ["jurisdiction", "sellerNTNCNIC", "buyerRegistrationType"]),
    execute: (args) => checkChannel(args),
  });

  actions.register({
    name: "validate_invoice_payload",
    description: "Check a draft digital-invoice payload field by field against the installed ruleset, including the self-invoicing rejection and the debit-note rules, and return the exact error list.",
    effect: "read",
    availability: "local-only",
    inputSchema: object({
      jurisdiction: JURISDICTION,
      invoiceJson: TEXT("The draft invoice as a JSON object string, using the authority's own field names."),
    }, ["jurisdiction", "invoiceJson"]),
    execute: (args) => validateInvoice({ jurisdiction: args.jurisdiction, invoiceJson: args.invoiceJson }),
  });

  actions.register({
    name: "file_petition_draft",
    description: "After the window has closed, build the Commissioner Inland Revenue petition text from the visitor's own facts and store that draft on this device, returning a receipt.",
    effect: "write",
    availability: "local-only",
    inputSchema: object({
      jurisdiction: JURISDICTION,
      invoiceRef: TEXT("FBR Digital Invoicing reference or invoice number."),
      generatedAt: TEXT("Invoice generation time, ISO 8601 with offset."),
      operation: { type: "string", description: "What is being asked for: cancel, delete or amend." },
      reason: TEXT("Why the change is needed, in the seller's own words."),
      region: TEXT("Commissionerate region, e.g. Rawalpindi, Lahore, Karachi. Optional."),
    }, ["jurisdiction", "invoiceRef", "generatedAt", "reason"]),
    async execute(args, { requestId }) {
      const text = petitionText(args);
      if (!text) return { verdict: "UNKNOWN_JURISDICTION", message: "No ruleset installed for that jurisdiction; no draft was made." };
      const digest = sha256Hex(`${requestId}|${text}`);
      const key = `oaw.petitions.${digest}`;
      try {
        localStorage.setItem(key, JSON.stringify({ ...args, text, filed_at: new Date().toISOString() }));
      } catch (error) {
        return { verdict: "NOT_FILED", reason: `This device refused to store the draft: ${error.message}`, outcome: "unknown" };
      }
      return {
        verdict: "DRAFT_FILED_ON_THIS_DEVICE",
        receipt: `petition-${digest}`,
        stored_at: key,
        text,
        // Spec 3.1: a returned response is not a business outcome. Nothing was sent to FBR.
        not_a_filing: "This draft stayed in your browser. It has not been submitted to the Board and no approval is implied.",
      };
    },
  });
}
