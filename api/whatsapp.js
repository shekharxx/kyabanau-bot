const twilio = require("twilio");

// ── Ingredient keyword map ───────────────────────────────────────────────
const INGREDIENT_MAP = {
  "potato":"aloo","potatoes":"aloo","aloo":"aloo","alu":"aloo","aaloo":"aloo",
  "onion":"pyaz","onions":"pyaz","pyaz":"pyaz","piyaz":"pyaz","pyaaz":"pyaz",
  "piaz":"pyaz","piyaaz":"pyaz","onoin":"pyaz",
  "tomato":"tamatar","tomatoes":"tamatar","tamatar":"tamatar","tamaatar":"tamatar",
  "tamater":"tamatar","tomatar":"tamatar",
  "spinach":"palak","palak":"palak","paalak":"palak",
  "cauliflower":"gobi","gobi":"gobi","gobhi":"gobi","govi":"gobi",
  "peas":"matar","matar":"matar","matter":"matar","mattar":"matar","mutter":"matar",
  "eggplant":"baingan","brinjal":"baingan","baingan":"baingan","baigan":"baingan",
  "begun":"baingan","bangan":"baingan",
  "okra":"bhindi","ladyfinger":"bhindi","bhindi":"bhindi","lady finger":"bhindi",
  "bottle gourd":"lauki","lauki":"lauki","loki":"lauki","louki":"lauki",
  "fenugreek":"methi","methi":"methi","meethi":"methi",
  "capsicum":"shimla mirch","bell pepper":"shimla mirch",
  "shimla mirch":"shimla mirch","shimlamirch":"shimla mirch","shimla":"shimla mirch",
  "paneer":"paneer","cottage cheese":"paneer","paner":"paneer",
  "curd":"dahi","dahi":"dahi","yogurt":"dahi","yoghurt":"dahi","dahi":"dahi",
  "rice":"chawal","chawal":"chawal","chaawal":"chawal",
  "cabbage":"patta gobi","patta gobi":"patta gobi","band gobi":"patta gobi",
  "carrot":"gajar","gajar":"gajar","gaajar":"gajar",
  "beans":"beans","french beans":"beans","green beans":"beans",
  "corn":"corn","sweet corn":"corn","makai":"corn",
  "karela":"karela","bitter gourd":"karela","kareela":"karela",
  "arbi":"arbi","taro":"arbi","arvi":"arbi",
  "tinda":"tinda","apple gourd":"tinda",
  "rajma":"rajma","kidney beans":"rajma",
  "kala chana":"kala chana","black chickpeas":"kala chana",
  "kabuli chana":"kabuli chana","chickpeas":"kabuli chana","chole":"kabuli chana",
  "kaddu":"kaddu","pumpkin":"kaddu","kaddoo":"kaddu",
  "mooli":"mooli","radish":"mooli","muli":"mooli",
  "suran":"suran","yam":"suran",
  "sarson":"sarson","mustard greens":"sarson",
  "oats":"oats",
  "poha":"poha","flattened rice":"poha","pohe":"poha",
  "suji":"suji","semolina":"suji","rava":"suji","sooji":"suji",
  "besan":"besan","chickpea flour":"besan",
  "sabudana":"sabudana","sago":"sabudana",
  "bread":"bread","ब्रेड":"bread",
  "seviyan":"seviyan","vermicelli":"seviyan","sewai":"seviyan",
  "dal":"arhar dal","arhar":"arhar dal","toor":"arhar dal",
  "moong":"moong dal","moong dal":"moong dal",
  "masoor":"masoor dal","masoor dal":"masoor dal","lentil":"masoor dal",
  "chana dal":"chana dal","urad":"urad dal","urad dal":"urad dal",
};

function extractIngredients(message) {
  const msg = message.toLowerCase().trim();
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

// ── Session store (in-memory, resets on redeploy — fine for POC) ─────────
const sessions = {};

function getSession(phone) {
  if (!sessions[phone]) sessions[phone] = { lastRecipes: [] };
  return sessions[phone];
}

// ── Airtable lookup ──────────────────────────────────────────────────────
async function findRecipes(ingredients) {
  const tableName = encodeURIComponent("Imported table");
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tableName}`;
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

  return scored.slice(0, 5);
}

// ── Reply formatters ─────────────────────────────────────────────────────
function formatRecipeList(recipes, ingredients) {
  const lines = [
    `🍛 *${ingredients.join(" + ")}* se yeh bana sakte hain:\n`,
    `🍛 *${ingredients.join(" + ")}* से यह बना सकते हैं:\n`
  ];

  recipes.forEach((r, i) => {
    lines.push(
      `*${i+1}. ${r.name}* — ${r.name_hindi || ""} (${r.cook_time_mins} min)`,
      `📍 ${r.region} · ${r.diet_type || "Veg"}`,
      ``
    );
  });

  lines.push(`──────────────────`);
  lines.push(`📩 *Recipe select karne ke liye sirf number bhejein:*`);
  lines.push(`👆 *सिर्फ नंबर भेजें — 1, 2, 3...*`);
  lines.push(`\n_Example: "2" bhejne par Aloo Methi ki recipe milegi_`);
  lines.push(`_उदाहरण: "2" भेजें तो उस recipe की maid card milegi_ 👩‍🍳`);

  return lines.join("\n");
}

function formatFullRecipe(recipe) {
  const steps = (recipe.cooking_steps || "")
    .split("|")
    .map((s, i) => `${i+1}. ${s.trim()}`)
    .join("\n");

  return [
    `🍛 *${recipe.name}* — ${recipe.name_hindi || ""}`,
    `📍 ${recipe.region} · ⏱ ${recipe.cook_time_mins} min · 👥 ${recipe.serves} servings`,
    ``,
    `*Ingredients / सामग्री:*`,
    (recipe.all_ingredients || "").split(",").map(i => `• ${i.trim()}`).join("\n"),
    ``,
    `*Steps / विधि:*`,
    steps,
    ``,
    `──────────────────`,
    `👩‍🍳 *Maid instructions chahiye? / मेड के लिए आसान निर्देश?*`,
    `Reply *MAID* to get simple step-by-step maid card`,
    `*MAID* भेजें — मेड के लिए आसान कार्ड मिलेगा 🙏`
  ].join("\n");
}

function formatMaidCard(recipe) {
  return [
    `👩‍🍳 *${recipe.name} — Maid Instructions*`,
    `👩‍🍳 *${recipe.name} — मेड के लिए निर्देश*`,
    ``,
    recipe.maid_instructions || "No maid instructions available.",
    ``,
    `──────────────────`,
    `_Yeh card apni maid ko forward kar sakte hain_ 📲`,
    `_यह card अपनी maid को forward करें_ 🙏`,
    ``,
    `_Kya Banau? — Aapka daily kitchen helper_`
  ].join("\n");
}

function helpMessage() {
  return [
    `🍛 *Kya Banau? — Aapka Kitchen Helper*`,
    `🍛 *क्या बनाऊं? — आपका किचन हेल्पर*`,
    ``,
    `*How to use / कैसे use करें:*`,
    `Jo vegetables aapke paas hain woh likhen:`,
    `जो सब्जियाँ आपके पास हों वो लिखें:`,
    ``,
    `*Examples:*`,
    `• aloo pyaz tamatar`,
    `• palak paneer`,
    `• gobi matar aloo`,
    `• भिंडी प्याज़`,
    ``,
    `Main top 5 recipes suggest karunga! 😊`,
    `मैं top 5 recipes suggest करूँगा! 😊`,
    ``,
    `──────────────────`,
    `*Commands / कमांड:*`,
    `• Number (1-5) → Full recipe + ingredients`,
    `• *MAID* → Simple maid instructions card`,
    `• *HELP* → This message / यह message`,
    ``,
    `_Kya Banau? is FREE — Share with friends!_ 🙏`,
    `_क्या बनाऊं? FREE है — दोस्तों को share करें!_ 🙏`
  ].join("\n");
}

// ── Main handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const userMessage = (req.body.Body || "").trim();
  const userPhone   = req.body.From || "";
  const session     = getSession(userPhone);

  // ── HELP ──
  if (!userMessage || ["help","hi","hello","helo","hii","hey","start"].includes(userMessage.toLowerCase())) {
    await sendWhatsApp(userPhone, helpMessage());
    return res.status(200).end();
  }

  // ── MAID — show maid card for last selected recipe ──
  if (userMessage.toUpperCase() === "MAID") {
    const recipe = session.lastSelectedRecipe || (session.lastRecipes && session.lastRecipes[0]);
    if (!recipe) {
      await sendWhatsApp(userPhone,
        `Pehle koi recipe select karein (1-5 bhejein) phir MAID likhein.\nपहले recipe select करें (1-5 भेजें) फिर MAID लिखें। 🙏`
      );
    } else {
      await sendWhatsApp(userPhone, formatMaidCard(recipe));
    }
    return res.status(200).end();
  }

  // ── NUMBER SELECTION (1-5) ──
  if (/^[1-5]$/.test(userMessage.trim())) {
    const idx = parseInt(userMessage.trim()) - 1;
    const recipes = session.lastRecipes || [];
    if (recipes.length === 0) {
      await sendWhatsApp(userPhone,
        `Pehle ingredients bhejein, phir number select karein.\nपहले ingredients भेजें, फिर number select करें। 😊`
      );
    } else if (idx >= recipes.length) {
      await sendWhatsApp(userPhone,
        `Sirf ${recipes.length} recipes hain. 1 se ${recipes.length} ke beech number bhejein.\nसिर्फ ${recipes.length} recipes हैं। 1 से ${recipes.length} के बीच number भेजें।`
      );
    } else {
      const chosen = recipes[idx];
      session.lastSelectedRecipe = chosen;
      await sendWhatsApp(userPhone, formatFullRecipe(chosen));
    }
    return res.status(200).end();
  }

  // ── INGREDIENT SEARCH ──
  const ingredients = extractIngredients(userMessage);

  if (ingredients.length === 0) {
    await sendWhatsApp(userPhone,
      `Kuch samajh nahi aaya 🤔\n\nIngredients ka naam likhein jaise:\n*aloo pyaz tamatar*\n\nYa *HELP* bhejein.\n\nकुछ समझ नहीं आया 🤔\nसब्जी का नाम लिखें जैसे: *आलू प्याज़ टमाटर*\nया *HELP* भेजें।`
    );
    return res.status(200).end();
  }

  const recipes = await findRecipes(ingredients);

  if (recipes.length === 0) {
    await sendWhatsApp(userPhone,
      `*${ingredients.join(", ")}* se koi recipe nahi mili. 😔\n\nAur ingredients add karein ya alag combination try karein!\n\n*${ingredients.join(", ")}* से कोई recipe नहीं मिली।\nAur सब्जियाँ add करें या अलग combination try करें! 🥗`
    );
    return res.status(200).end();
  }

  // Save to session
  session.lastRecipes = recipes;
  session.lastSelectedRecipe = null;

  await sendWhatsApp(userPhone, formatRecipeList(recipes, ingredients));
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
