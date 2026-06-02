const twilio = require("twilio");

// ── Ingredient keyword map ────────────────────────────────────────────────
const INGREDIENT_MAP = {
  "potato":"aloo","potatoes":"aloo","aloo":"aloo","alu":"aloo","aaloo":"aloo",
  "onion":"pyaz","onions":"pyaz","pyaz":"pyaz","piyaz":"pyaz","pyaaz":"pyaz","piaz":"pyaz",
  "tomato":"tamatar","tomatoes":"tamatar","tamatar":"tamatar","tamater":"tamatar","tomatar":"tamatar",
  "spinach":"palak","palak":"palak","paalak":"palak",
  "cauliflower":"gobi","gobi":"gobi","gobhi":"gobi","govi":"gobi",
  "peas":"matar","matar":"matar","matter":"matar","mattar":"matar","mutter":"matar",
  "eggplant":"baingan","brinjal":"baingan","baingan":"baingan","baigan":"baingan","begun":"baingan",
  "okra":"bhindi","ladyfinger":"bhindi","bhindi":"bhindi",
  "bottle gourd":"lauki","lauki":"lauki","loki":"lauki","louki":"lauki",
  "fenugreek":"methi","methi":"methi","meethi":"methi",
  "capsicum":"shimla mirch","bell pepper":"shimla mirch","shimla mirch":"shimla mirch","shimla":"shimla mirch",
  "paneer":"paneer","cottage cheese":"paneer","paner":"paneer",
  "curd":"dahi","dahi":"dahi","yogurt":"dahi",
  "rice":"chawal","chawal":"chawal",
  "cabbage":"patta gobi","patta gobi":"patta gobi","band gobi":"patta gobi",
  "carrot":"gajar","gajar":"gajar",
  "beans":"beans","french beans":"beans",
  "corn":"corn","sweet corn":"corn","makai":"corn",
  "karela":"karela","bitter gourd":"karela",
  "arbi":"arbi","taro":"arbi","arvi":"arbi",
  "tinda":"tinda","kaddu":"kaddu","pumpkin":"kaddu",
  "mooli":"mooli","radish":"mooli",
  "rajma":"rajma","kidney beans":"rajma",
  "chana":"kala chana","kala chana":"kala chana","chole":"kabuli chana","chickpeas":"kabuli chana",
  "oats":"oats","poha":"poha","pohe":"poha",
  "suji":"suji","semolina":"suji","rava":"suji","sooji":"suji",
  "besan":"besan","sabudana":"sabudana",
  "bread":"bread","seviyan":"seviyan","vermicelli":"seviyan",
  "dal":"arhar dal","arhar":"arhar dal","moong":"moong dal","masoor":"masoor dal",
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

// ── Airtable: search by ingredients ──────────────────────────────────────
async function findRecipes(ingredients) {
  const tableName = encodeURIComponent("Imported table");
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tableName}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }
  });
  const data = await resp.json();
  if (!data.records) return [];

  return data.records
    .map(rec => {
      const f = rec.fields;
      const ri = (f.all_ingredients || "").toLowerCase().split(",").map(s => s.trim());
      const matches = ingredients.filter(i => ri.includes(i));
      return { ...f, matchCount: matches.length, matchedWith: matches };
    })
    .filter(r => r.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, 5);
}

// ── Airtable: fetch single recipe by name (stateless lookup) ─────────────
async function findRecipeByName(recipeName) {
  const tableName = encodeURIComponent("Imported table");
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tableName}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }
  });
  const data = await resp.json();
  if (!data.records) return null;

  const query = recipeName.toLowerCase().trim();
  return data.records
    .map(r => r.fields)
    .find(f =>
      (f.name || "").toLowerCase() === query ||
      (f.name_hindi || "").toLowerCase() === query ||
      (f.name || "").toLowerCase().includes(query) ||
      query.includes((f.name || "").toLowerCase())
    ) || null;
}

// ── Formatters ────────────────────────────────────────────────────────────
function formatRecipeList(recipes, ingredients) {
  const lines = [
    `🍛 *${ingredients.join(" + ")}* se yeh bana sakte hain:`,
    `🍛 *${ingredients.join(" + ")}* से यह बना सकते हैं:\n`,
  ];

  recipes.forEach((r, i) => {
    lines.push(`*${i+1}.* ${r.name} — _${r.name_hindi || ""}_  ⏱ ${r.cook_time_mins} min`);
    lines.push(`    📍 ${r.region} · ${(r.diet_type||"Veg").split(",")[0]}`);
    lines.push(``);
  });

  lines.push(`──────────────────`);
  lines.push(`👇 *Recipe ka naam bhejein / नाम भेजें:*`);
  lines.push(`_Example: "Aloo Methi" ya "Dal Tadka"_`);
  lines.push(`_Poori recipe + maid card milega!_ 👩‍🍳`);

  return lines.join("\n");
}

function formatFullRecipeAndMaid(recipe) {
  const steps = (recipe.cooking_steps || "")
    .split("|").map((s,i) => `${i+1}. ${s.trim()}`).join("\n");

  const ingredientList = (recipe.all_ingredients || "")
    .split(",").map(i => `• ${i.trim()}`).join("\n");

  return [
    `🍛 *${recipe.name}*`,
    `🍛 *${recipe.name_hindi || ""}*`,
    `📍 ${recipe.region} · ⏱ ${recipe.cook_time_mins} min · 👥 Serves ${recipe.serves}`,
    ``,
    `*Ingredients / सामग्री:*`,
    ingredientList,
    ``,
    `*Steps / विधि:*`,
    steps,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `👩‍🍳 *Maid Instructions / मेड के लिए:*`,
    ``,
    recipe.maid_instructions || "Not available.",
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📲 _Yeh card apni maid ko forward karein_`,
    `📲 _यह card मेड को forward करें_ 🙏`,
    ``,
    `_Naya search karne ke liye ingredients bhejein!_`,
    `_नया search करें — सब्ज़ियों का नाम भेजें!_ 🍛`,
  ].join("\n");
}

function helpMessage() {
  return [
    `🍛 *Kya Banau? — Kitchen Helper*`,
    `🍛 *क्या बनाऊं? — किचन हेल्पर*`,
    ``,
    `*Kaise use karein / कैसे use करें:*`,
    ``,
    `*Step 1:* Vegetables ka naam bhejein`,
    `*Step 1:* सब्ज़ियों का नाम भेजें`,
    `_Example: aloo pyaz tamatar_`,
    ``,
    `*Step 2:* Recipe ka naam bhejein`,
    `*Step 2:* Recipe का नाम भेजें`,
    `_Example: Aloo Methi_`,
    ``,
    `*Step 3:* Poori recipe + maid card milega!`,
    `*Step 3:* पूरी recipe + maid card मिलेगा! 👩‍🍳`,
    ``,
    `──────────────────`,
    `*Examples try karein:*`,
    `▸ aloo pyaz tamatar`,
    `▸ palak paneer`,
    `▸ gobi matar`,
    `▸ bhindi`,
    `▸ dal chawal`,
    ``,
    `_FREE service — Share with friends!_ 🙏`,
    `_FREE service — दोस्तों को share करें!_ 🙏`,
  ].join("\n");
}

// ── Main handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const userMessage = (req.body.Body || "").trim();
  const userPhone   = req.body.From || "";

  // ── HELP / GREETING ──
  const greetings = ["help","hi","hello","helo","hii","hey","start","menu","ok","okay","haan"];
  if (!userMessage || greetings.includes(userMessage.toLowerCase())) {
    await sendWhatsApp(userPhone, helpMessage());
    return res.status(200).end();
  }

  // ── RECIPE NAME LOOKUP (stateless) ──
  // If message is NOT a pure ingredient list, try it as a recipe name first
  const ingredients = extractIngredients(userMessage);
  const looksLikeRecipeName = userMessage.length > 2 && ingredients.length === 0;
  const mightBeRecipeName   = ingredients.length > 0 && userMessage.split(" ").length <= 4
                               && /[A-Z]/.test(userMessage); // has capital = likely a name

  if (looksLikeRecipeName || mightBeRecipeName) {
    const recipe = await findRecipeByName(userMessage);
    if (recipe) {
      await sendWhatsApp(userPhone, formatFullRecipeAndMaid(recipe));
      return res.status(200).end();
    }
  }

  // ── INGREDIENT SEARCH ──
  if (ingredients.length === 0) {
    await sendWhatsApp(userPhone,
      `Samajh nahi aaya 🤔\n\nVegetables ka naam likhein:\n*aloo pyaz tamatar*\n\nYa *HELP* bhejein.\n\n─\nसमझ नहीं आया 🤔\nसब्ज़ी का नाम लिखें: *आलू प्याज़ टमाटर*\nया *HELP* भेजें।`
    );
    return res.status(200).end();
  }

  const recipes = await findRecipes(ingredients);

  if (recipes.length === 0) {
    await sendWhatsApp(userPhone,
      `*${ingredients.join(", ")}* se koi recipe nahi mili 😔\n\nAur ingredients add karke try karein!\n─\n*${ingredients.join(", ")}* से कोई recipe नहीं मिली।\nAur सब्ज़ियाँ add करें या अलग combination try करें! 🥗`
    );
    return res.status(200).end();
  }

  await sendWhatsApp(userPhone, formatRecipeList(recipes, ingredients));
  res.status(200).end();
}

// ── Twilio sender ─────────────────────────────────────────────────────────
async function sendWhatsApp(to, body) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to,
    body
  });
}
