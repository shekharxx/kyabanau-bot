const twilio = require("twilio");

// ── Ingredient keyword map ───────────────────────────────────────────────
const INGREDIENT_MAP = {
  "potato":"aloo","potatoes":"aloo","aloo":"aloo","alu":"aloo","aaloo":"aloo",
  "onion":"pyaz","onions":"pyaz","pyaz":"pyaz","piyaz":"pyaz",
  "tomato":"tamatar","tomatoes":"tamatar","tamatar":"tamatar","tamaatar":"tamatar",
  "spinach":"palak","palak":"palak",
  "cauliflower":"gobi","gobi":"gobi","gobhi":"gobi",
  "peas":"matar","matar":"matar","matter":"matar","mattar":"matar",
  "eggplant":"baingan","brinjal":"baingan","baingan":"baingan","begun":"baingan",
  "okra":"bhindi","ladyfinger":"bhindi","bhindi":"bhindi",
  "bottle gourd":"lauki","lauki":"lauki",
  "fenugreek":"methi","methi":"methi",
  "capsicum":"shimla mirch","bell pepper":"shimla mirch",
  "shimla mirch":"shimla mirch","shimlamirch":"shimla mirch",
  "paneer":"paneer","cottage cheese":"paneer",
  "curd":"dahi","dahi":"dahi","yogurt":"dahi",
  "rice":"chawal","chawal":"chawal",
  "cabbage":"patta gobi","patta gobi":"patta gobi",
  "carrot":"gajar","gajar":"gajar",
  "beans":"beans","french beans":"beans",
  "corn":"corn","sweet corn":"corn",
  "karela":"karela","bitter gourd":"karela",
  "arbi":"arbi","taro":"arbi",
  "tinda":"tinda","apple gourd":"tinda",
  "rajma":"rajma","kidney beans":"rajma",
  "chana":"kala chana","kala chana":"kala chana","chickpeas":"kabuli chana","chole":"kabuli chana",
  "kaddu":"kaddu","pumpkin":"kaddu",
  "mooli":"mooli","radish":"mooli",
  "suran":"suran","yam":"suran",
  "sarson":"sarson","mustard greens":"sarson",
  "oats":"oats",
  "poha":"poha","flattened rice":"poha",
  "suji":"suji","semolina":"suji","rava":"suji",
  "besan":"besan","chickpea flour":"besan",
  "sabudana":"sabudana","sago":"sabudana",
  "bread":"bread",
  "seviyan":"seviyan","vermicelli":"seviyan",
};

function extractIngredients(message) {
  const msg = message.toLowerCase();
  const found = new Set();
  const sorted = Object.keys(INGREDIENT_MAP).sort((a,b) => b.length - a.length);
  let remaining = msg;
  for (const key of sorted) {
    if (remaining.includes(key)) {
      found.add(INGREDIENT_MAP[key]);
      remaining = remaining.replaceAll(key, " ");
    }
  }
  return [...found];
}

// ── Airtable lookup ──────────────────────────────────────────────────────
async function findRecipes(ingredients) {
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Imported%20table`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }
  });
  const data = await resp.json();
  if (!data.records) return [];

  const scored = data.records
    .map(rec => {
      const f = rec.fields;
      const recipeIngredients = (f.all_ingredients || "")
        .toLowerCase().split(",").map(s => s.trim());
      const matches = ingredients.filter(i => recipeIngredients.includes(i));
      return { ...f, matchCount: matches.length, matchedWith: matches };
    })
    .filter(r => r.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);

  return scored.slice(0, 3);
}

// ── Reply formatter ──────────────────────────────────────────────────────
function formatReply(recipes, ingredients) {
  const lines = [`🍛 *${ingredients.join(" + ")}* se yeh bana sakte hain:\n`];
  recipes.forEach((r, i) => {
    lines.push(`*${i+1}. ${r.name}* (${r.cook_time_mins} min)`);
    lines.push(`📍 ${r.region} · Uses: ${r.matchedWith.join(", ")}`);
    const steps = (r.cooking_steps || "").split("|").slice(0,3).join(" → ");
    lines.push(`_${steps}_\n`);
    if (i < recipes.length - 1) lines.push("─────────────");
  });
  lines.push("Reply *MAID* for simple maid instructions 👩‍🍳");
  lines.push("_Kya Banau? — Aapka daily kitchen helper_");
  return lines.join("\n");
}

function formatMaidReply(recipe) {
  return `👩‍🍳 *${recipe.name} — Maid Instructions*\n\n${recipe.maid_instructions}\n\n_Kya Banau? — Share this card with your maid_ 🍛`;
}

// ── Main handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body;
  const userMessage = (body.Body || "").trim();
  const userPhone   = body.From || "";

  // MAID mode — return maid instructions for last recipe
  if (userMessage.toUpperCase() === "MAID") {
    // Simple: search for a random popular recipe
    const recipes = await findRecipes(["aloo"]);
    if (recipes.length > 0) {
      await sendWhatsApp(userPhone, formatMaidReply(recipes[0]));
    }
    return res.status(200).end();
  }

  // HELP message
  if (userMessage.toUpperCase() === "HELP" || userMessage === "hi" || userMessage === "hello") {
    await sendWhatsApp(userPhone,
      "🍛 *Kya Banau? — Kitchen Helper*\n\nMujhe batao aapke paas kya vegetables hain!\n\n*Example:*\n• aloo pyaz tamatar\n• palak paneer\n• gobi matar aloo\n\nMain aapko best recipes suggest karunga! 😊\n\n_Type HELP anytime for this message._"
    );
    return res.status(200).end();
  }

  const ingredients = extractIngredients(userMessage);

  if (ingredients.length === 0) {
    await sendWhatsApp(userPhone,
      "Kuch samajh nahi aaya 🤔\n\nIngredients ka naam likhein, jaise:\n*aloo pyaz tamatar*\n\nYa *HELP* likhen for instructions."
    );
    return res.status(200).end();
  }

  const recipes = await findRecipes(ingredients);

  if (recipes.length === 0) {
    await sendWhatsApp(userPhone,
      `*${ingredients.join(", ")}* se koi recipe nahi mili.\n\nKuch aur ingredients add karein ya alag combination try karein! 🥗`
    );
    return res.status(200).end();
  }

  await sendWhatsApp(userPhone, formatReply(recipes, ingredients));
  res.status(200).end();
}

// ── Twilio sender ────────────────────────────────────────────────────────
async function sendWhatsApp(to, body) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to,
    body
  });
}
