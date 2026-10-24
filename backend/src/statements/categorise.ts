/**
 * Rule-based first guess at a category. Users can change anything on the
 * review screen; uncertain guesses are flagged for review.
 * Keys match the system categories seeded in supabase/migrations.
 */
import { normaliseForMatch } from "./clean.js";

export type TransactionType = "income" | "expense" | "transfer" | "refund" | "unknown";
export type Direction = "inflow" | "outflow";

export type CategoryGuess = {
  categoryKey: string;
  transactionType: TransactionType;
  /** 0–1. Below REVIEW_THRESHOLD the row is flagged for review. */
  confidence: number;
};

export const REVIEW_THRESHOLD = 0.6;

type Rule = { key: string; type?: TransactionType; words: string[]; direction?: Direction };

// Checked in order: the first matching rule wins.
const RULES: Rule[] = [
  { key: "transfers", type: "transfer", words: ["own acc", "own account", "inter account", "interacc", "transfer to", "transfer from", "trf to", "trf from", "internal transfer", "send money to savings", "move money"] },
  { key: "refunds", type: "refund", direction: "inflow", words: ["refund", "reversal", "reversed", "chargeback", "returned debit order", "rd ret"] },
  { key: "salary", type: "income", direction: "inflow", words: ["salary", "salaries", "payroll", "wages", "sal ", "remuneration", "stipend"] },
  { key: "bank_fees", words: ["service fee", "monthly fee", "account fee", "admin fee", "bank charge", "bank charges", "transaction fee", "cash handling", "sms notification", "notification fee", "overdraft interest", "debit interest", "fee "] },
  { key: "cash_withdrawal", words: ["atm", "cash withdrawal", "cash wdl", "withdrawal at", "cashsend", "cash send"] },
  { key: "groceries", words: ["checkers", "shoprite", "pick n pay", "picknpay", "pnp ", "woolworths food", "woolworths", "spar", "food lover", "boxer", "usave", "makro food", "ok foods", "superspar", "kwikspar", "fruit and veg", "fruit veg"] },
  { key: "eating_out", words: ["uber eats", "ubereats", "mr d", "mrd food", "kfc", "mcdonald", "nando", "steers", "debonairs", "wimpy", "spur", "romans pizza", "roman s pizza", "chicken licken", "burger king", "ocean basket", "starbucks", "vida e", "seattle coffee", "mugg bean", "restaurant", "takeaway", "fishaways", "pizza"] },
  { key: "transport", words: ["uber", "bolt", "engen", "shell", "sasol", "bp ", "caltex", "total energies", "totalenergies", "astron", "petrol", "fuel", "gautrain", "taxi", "toll", "sanral", "e toll", "parking", "myciti", "rea vaya", "putco", "intercape", "flysafair", "airlink", "lift airline"] },
  { key: "airtime_data", words: ["vodacom", "mtn", "cell c", "cellc", "telkom", "rain ", "airtime", "prepaid data", "data bundle", "afrihost", "vumatel", "openserve", "webafrica", "mweb"] },
  { key: "utilities", words: ["eskom", "prepaid electricity", "prepaid elec", "electricity", "city of", "municipal", "municipality", "water and lights", "rates and taxes", "city power", "joburg water"] },
  { key: "subscriptions", words: ["netflix", "showmax", "spotify", "dstv", "multichoice", "apple com", "apple.com", "itunes", "google", "youtube", "disney", "amazon prime", "prime video", "microsoft", "openai", "anthropic", "adobe", "icloud", "deezer", "gym", "virgin active", "planet fitness"] },
  { key: "insurance", words: ["insurance", "assurance", "outsurance", "old mutual", "sanlam", "momentum", "liberty", "hollard", "santam", "king price", "miway", "budget insurance", "dial direct", "clientele", "funeral", "avbob", "1life"] },
  { key: "medical", words: ["dis chem", "dischem", "clicks", "pharmacy", "medical", "doctor", "dentist", "hospital", "netcare", "mediclinic", "life healthcare", "pathcare", "lancet", "optometrist", "spec savers", "specsavers", "discovery health", "bonitas", "medshield", "gems "] },
  { key: "education", words: ["school", "university", "unisa", "college", "tuition", "varsity", "wits", "uct", "tut ", "creche", "daycare", "nsfas", "textbook"] },
  { key: "housing", words: ["rent", "rental", "bond", "home loan", "levy", "levies", "body corporate", "property"] },
  { key: "debt_repayments", words: ["loan", "credit card payment", "card repayment", "repayment", "instalment", "installment", "wesbank", "mfc ", "lay buy", "laybuy", "payjustnow", "mobicred", "rcs ", "edgars account", "truworths account"] },
  { key: "savings", type: "transfer", words: ["savings", "save ", "tax free", "unit trust", "easyequities", "satrix", "allan gray", "coronation", "10x", "sygnia", "investment", "fixed deposit", "notice deposit"] },
  { key: "shopping", words: ["takealot", "mr price", "mrp ", "pep ", "pepkor", "ackermans", "jet ", "edgars", "truworths", "foschini", "markham", "sportscene", "totalsports", "game ", "makro", "builders", "cashbuild", "incredible connection", "hifi corp", "superbalist", "shein", "temu", "amazon", "clothing"] },
  { key: "personal_care", words: ["salon", "barber", "hair", "beauty", "nail", "spa ", "cosmetic"] },
  { key: "entertainment", words: ["ster kinekor", "nu metro", "computicket", "ticketpro", "quicket", "playstation", "xbox", "steam", "betway", "hollywoodbets", "supabets", "lotto", "casino"] },
  { key: "gifts_donations", words: ["donation", "charity", "church", "tithe", "offering", "gift of the givers"] },
];

/** Short keywords match whole words only; longer ones (6+ letters) can match inside words. */
function matches(text: string, phrase: string): boolean {
  const p = normaliseForMatch(phrase);
  if (!p) return false;
  return ` ${text} `.includes(` ${p} `) || (p.length >= 6 && text.includes(p));
}

export function guessCategory(description: string, direction: Direction): CategoryGuess {
  const text = normaliseForMatch(description);

  for (const rule of RULES) {
    if (rule.direction && rule.direction !== direction) continue;
    if (!rule.words.some((word) => matches(text, word))) continue;

    if (rule.type) return { categoryKey: rule.key, transactionType: rule.type, confidence: 0.85 };
    // Expense categories: money coming back in on these is probably a refund.
    if (direction === "inflow") return { categoryKey: "refunds", transactionType: "refund", confidence: 0.5 };
    return { categoryKey: rule.key, transactionType: "expense", confidence: 0.85 };
  }

  // Not every credit is income: unknown inflows need the user to decide.
  if (direction === "inflow") return { categoryKey: "other_income", transactionType: "unknown", confidence: 0.4 };
  return { categoryKey: "uncategorised", transactionType: "expense", confidence: 0.3 };
}
