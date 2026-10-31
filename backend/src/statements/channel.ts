/**
 * HOW money moved (card, debit order, ATM...), separate from WHAT it was for
 * (the category). Read from the wording SA banks put in front of descriptions,
 * e.g. FNB "POS Purchase", Capitec "Card Purchase", Absa "Acb Debit",
 * Standard Bank "Autobank Cash Withdrawal", Nedbank "Send-iMali".
 */
import { normaliseForMatch } from "./clean.js";
import type { Direction } from "./categorise.js";

export type Channel =
  | "card_purchase"
  | "debit_order"
  | "eft_payment"
  | "eft_received"
  | "atm_withdrawal"
  | "cash_deposit"
  | "bank_fee"
  | "interest"
  | "prepaid"
  | "internal_transfer"
  | "reversal"
  | "unknown";

export const CHANNEL_LABELS: Record<Channel, string> = {
  card_purchase: "Card purchase",
  debit_order: "Debit order",
  eft_payment: "Payment (EFT)",
  eft_received: "Payment received",
  atm_withdrawal: "ATM / cash withdrawal",
  cash_deposit: "Cash deposit",
  bank_fee: "Bank fee",
  interest: "Interest",
  prepaid: "Prepaid purchase",
  internal_transfer: "Transfer between own accounts",
  reversal: "Reversal / refund",
  unknown: "Other",
};

type ChannelRule = { channel: Channel; direction?: Direction; phrases: string[] };

// Order matters: the first match wins.
const RULES: ChannelRule[] = [
  { channel: "reversal", phrases: ["reversal", "reversed", "refund", "chargeback", "returned debit", "rd ret", "unpaid debit"] },
  { channel: "internal_transfer", phrases: ["own acc", "own account", "inter account", "interacc", "internal transfer", "transfer to savings", "transfer from savings", "move money", "trf own", "tfr own"] },
  { channel: "bank_fee", phrases: ["service fee", "monthly fee", "account fee", "admin fee", "bank charge", "transaction fee", "cash handling", "notification fee", "sms fee", "fee ", "fees ", "#fee", "honouring fee", "unpaid fee", "card fee"] },
  { channel: "interest", phrases: ["interest", "int pmt", "credit int", "debit int"] },
  { channel: "debit_order", phrases: ["debit order", "debicheck", "debi check", "acb debit", "magtape debit", "naedo", "external debit", "ext debit", "dr order"] },
  { channel: "atm_withdrawal", phrases: ["atm", "cash withdrawal", "cash wdl", "autobank", "cash at till", "cashback", "cash back", "withdrawal at"] },
  { channel: "cash_deposit", direction: "inflow", phrases: ["cash deposit", "atm deposit", "deposit cash", "branch deposit", "adt cash"] },
  { channel: "prepaid", phrases: ["prepaid", "airtime", "data bundle", "electricity purchase", "lotto purchase", "voucher purchase", "pre paid"] },
  { channel: "card_purchase", direction: "outflow", phrases: ["pos purchase", "card purchase", "purchase", "pos ", "contactless", "tap ", "online purchase", "card transaction", "virtual card"] },
  { channel: "eft_received", direction: "inflow", phrases: ["payment received", "payment from", "credit transfer", "eft credit", "deposit", "magtape credit", "acb credit", "inward payment", "payshap from", "salary", "immediate payment from", "rtc credit", "inward eft"] },
  { channel: "eft_payment", direction: "outflow", phrases: ["payment to", "ib payment", "digital payment", "app payment", "internet payment", "eft", "immediate payment", "payshap", "send imali", "send money", "instant money", "cashsend", "cash send", "transfer to", "trf to", "online payment", "banking app payment"] },
];

function matches(text: string, phrase: string): boolean {
  const p = normaliseForMatch(phrase);
  if (!p) return false;
  return ` ${text} `.includes(` ${p} `) || (p.length >= 6 && text.includes(p));
}

export function detectChannel(description: string, direction: Direction): Channel {
  const text = normaliseForMatch(description);
  for (const rule of RULES) {
    if (rule.direction && rule.direction !== direction) continue;
    if (rule.phrases.some((p) => matches(text, p))) return rule.channel;
  }
  return "unknown";
}
