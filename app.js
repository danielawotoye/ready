/* ============================================================
   Ready: emergency kit planner
   ------------------------------------------------------------
   1. CONSTANTS  - the numbers behind the kit. Tune these.
   2. STATE      - what the user picked, saved on this device.
   3. APIs       - Nominatim (place search) and the National
                   Weather Service (live alerts).
   4. ENGINE     - turns the household into a kit list.
   5. RENDER     - draws the page.
   6. EVENTS     - wires up buttons and inputs.
   ============================================================ */

/* ================= 1. CONSTANTS ================= */

// Water: 1 gallon per person per day (Ready.gov and Red Cross).
const WATER_GAL_PER_PERSON_DAY = 1;
// Ready.gov: "In very hot temperatures, water needs can double."
const HEAT_WATER_MULTIPLIER = 2;
// Pets: dogs drink about ½ to 1 oz per pound a day; we use the safe end (1 oz).
// Cats drink about 5 to 10 oz a day; we use 10.
const DOG_OZ_PER_LB_DAY = 1;
const CAT_OZ_PER_DAY = 10;
const OZ_PER_GAL = 128;
const LB_PER_GAL = 8.34;

// Calories per day by person type, for food planning (rough adult averages).
const CALORIES = { adults: 2000, older: 1800, kids: 1400 };

const PEOPLE = {
  adults: { label: "Adults and teens", note: "13 and up" },
  older:  { label: "Older adults",     note: "65 and up" },
  kids:   { label: "Kids",             note: "2 to 12" },
  babies: { label: "Babies",           note: "under 2" },
};

const PETS = {
  dogS: { label: "Small dogs",  note: "under 25 lb", lb: 20 },
  dogM: { label: "Medium dogs", note: "25 to 60 lb", lb: 45 },
  dogL: { label: "Large dogs",  note: "over 60 lb",  lb: 85 },
  cats: { label: "Cats",        note: "",            lb: 0 },
};

// Threats. "match" decides which NWS alert names switch each one on.
const THREATS = {
  hurricane: { label: "Hurricanes",       match: /hurricane|tropical storm|storm surge/i },
  winter:    { label: "Snow and ice",     match: /winter|blizzard|ice storm|snow|freez|frost|wind chill|extreme cold|cold weather/i },
  heat:      { label: "Extreme heat",     match: /heat/i },
  flood:     { label: "Flooding",         match: /flood/i },
  outage:    { label: "Power outages",    match: /high wind|severe thunderstorm|extreme wind|ice storm|hurricane|tropical storm/i },
  tornado:   { label: "Tornadoes",        match: /tornado/i },
  wildfire:  { label: "Wildfire and smoke", match: /red flag|fire weather|fire warning|smoke|air quality/i },
  earthquake:{ label: "Earthquakes",      match: /earthquake/i },
};

const SOURCES = {
  ready:    { label: "Ready.gov",     url: "https://www.ready.gov/kit" },
  water:    { label: "Ready.gov",     url: "https://www.ready.gov/water" },
  redcross: { label: "Red Cross",     url: "https://www.redcross.org/get-help/how-to-prepare-for-emergencies/survival-kit-supplies.html" },
  pets:     { label: "vet guideline", url: "https://web4.lifelearn.com/?p=1837" },
};

// Default prices per pack. Rough big-box-store estimates; users can edit them.
const PRICES = {
  water: 4.5, waterBag: 6, cans: 7, pb: 3.5, bars: 7, trail: 8, opener: 5,
  formula: 6, diapers: 14, petfood: 2, leash: 15,
  flashlight: 12, batteries: 16, radio: 30, powerbank: 22, lantern: 20, cooler: 30,
  firstaid: 25, otc: 15, masks: 15,
  whistle: 6, multitool: 15, sheeting: 18, wipes: 5, bags: 9, blankets: 8, docs: 10, map: 6,
  warmers: 10, icemelt: 12, tarp: 15, bin: 12, electrolytes: 12, fan: 20, drybag: 15,
};

// Upkeep: how often to check each part of the kit.
const UPKEEP = [
  { id: "water",     label: "Stored water",            months: 6,  note: "Water you bottled yourself: replace every 6 months. Store-bought: go by the date on the bottle.", src: "water" },
  { id: "food",      label: "Food",                    months: 12, note: "Check use-by dates and swap out anything close.", src: "ready" },
  { id: "batteries", label: "Batteries and power banks", months: 6, note: "Test the flashlights and radio, and recharge power banks.", src: null },
  { id: "meds",      label: "First aid and medications", months: 12, note: "Replace expired meds and restock anything you used.", src: "ready" },
  { id: "whole",     label: "Whole kit review",        months: 12, note: "Re-think what your household needs once a year.", src: "ready" },
];

const STORAGE_KEY = "ready-plan-v1";
const NWS = "https://api.weather.gov";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/* ================= 2. STATE ================= */

function defaultState() {
  return {
    people: { adults: 2, older: 0, kids: 0, babies: 0 },
    pets: { dogS: 0, dogM: 0, dogL: 0, cats: 0 },
    kit: "home",
    days: 14,
    threats: [],
    location: null,                   // { lat, lon, label }
    alerts: null,                     // { items: [...], fetchedAt, label }
    have: {},
    prices: {},
    showMath: false,
    paychecks: 3,
    upkeep: {},
    tab: "kit",
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...saved, people: { ...d.people, ...saved.people }, pets: { ...d.pets, ...saved.pets } };
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: app still works */ }
}

let state = loadState();

/* ================= HELPERS ================= */

const $ = (id) => document.getElementById(id);
const roundMoney = (n) => "$" + Math.round(n).toLocaleString();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
const priceOf = (key) => (typeof state.prices[key] === "number" ? state.prices[key] : PRICES[key]);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function sourceLink(key) {
  const s = SOURCES[key];
  return s ? ` <a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>` : "";
}

/* ================= 3. APIs ================= */

// Turn "20052" or "Miami, FL" into coordinates. Only runs when the user presses Find
// (Nominatim's rules: no search-as-you-type, at most 1 request per second).
async function searchPlace(query) {
  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&countrycodes=us&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("search-failed");
  const data = await res.json();
  if (!data.length) throw new Error("not-found");
  const a = data[0].address || {};
  const place = a.city || a.town || a.village || a.hamlet || a.suburb || a.county;
  const iso = a["ISO3166-2-lvl4"] || ""; // e.g. "US-DC"
  const st = iso.startsWith("US-") ? iso.slice(3) : a.state;
  const label = [place, st].filter(Boolean).join(", ") || data[0].display_name;
  return { lat: Number(data[0].lat), lon: Number(data[0].lon), label };
}

// Name a GPS position ("Arlington, VA") using the NWS points endpoint.
async function nameForPoint(lat, lon) {
  try {
    const res = await fetch(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { Accept: "application/geo+json" } });
    if (!res.ok) return "Your location";
    const data = await res.json();
    const rel = data.properties && data.properties.relativeLocation && data.properties.relativeLocation.properties;
    return rel ? `${rel.city}, ${rel.state}` : "Your location";
  } catch (e) {
    return "Your location";
  }
}

// Active weather alerts for a point. Only covers the US.
async function fetchAlerts(lat, lon) {
  const res = await fetch(`${NWS}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { Accept: "application/geo+json" } });
  if (res.status === 400 || res.status === 404) throw new Error("outside-us");
  if (!res.ok) throw new Error("nws-failed");
  const data = await res.json();
  const seen = new Set();
  return (data.features || [])
    .map((f) => f.properties || {})
    .filter((p) => p.event && !seen.has(p.event) && seen.add(p.event))
    .map((p) => ({
      event: p.event,
      headline: p.headline || "",
      severity: p.severity || "",
      ends: p.ends || p.expires || "",
      area: p.areaDesc || "",
      sender: p.senderName || "",
    }));
}

function alertLevel(event) {
  if (/warning/i.test(event)) return "warn";
  if (/watch/i.test(event)) return "watch";
  return "advisory";
}

// Alerts that haven't ended yet (matters when we show a saved copy offline).
function liveAlerts() {
  if (!state.alerts) return [];
  const now = Date.now();
  return state.alerts.items.filter((a) => !a.ends || new Date(a.ends).getTime() > now);
}

// Which threats the current alerts switch on, and which alert caused each.
function alertThreats() {
  const out = {};
  liveAlerts().forEach((a) => {
    Object.entries(THREATS).forEach(([key, t]) => {
      if (t.match.test(a.event) && !out[key]) out[key] = a.event;
    });
  });
  return out;
}

/* ================= 4. ENGINE ================= */

function computeKit() {
  const P = state.people;
  const days = state.kit === "bag" ? 3 : state.days;
  const humans = P.adults + P.older + P.kids + P.babies;
  const nonBaby = P.adults + P.older + P.kids;
  const grownUps = P.adults + P.older;
  const dogs = state.pets.dogS + state.pets.dogM + state.pets.dogL;
  const cats = state.pets.cats;
  const fromAlert = alertThreats();
  const picked = new Set(state.threats);
  const has = (t) => picked.has(t) || !!fromAlert[t];
  const isBag = state.kit === "bag";

  const lines = [];
  // need = how many units you need; per = units in one pack.
  function add(line) {
    const packs = line.reminder ? 0 : Math.ceil(line.need / line.per);
    const cost = line.reminder ? 0 : packs * priceOf(line.price);
    lines.push({ ...line, packs, cost });
  }
  function threatNote(t) {
    return fromAlert[t] ? `Added because of the ${fromAlert[t]} for your area.` : `Because you picked ${THREATS[t].label.toLowerCase()}.`;
  }
  const threatPriority = (t) => (fromAlert[t] ? 0 : 3);

  if (humans + dogs + cats === 0) return { lines, days, humans, totals: totalsFor(lines), fromAlert, waterGal: 0 };

  /* --- Water --- */
  const heatX = has("heat") ? HEAT_WATER_MULTIPLIER : 1;
  const humanGal = humans * WATER_GAL_PER_PERSON_DAY * heatX * days;
  const petOzDay = state.pets.dogS * PETS.dogS.lb + state.pets.dogM * PETS.dogM.lb + state.pets.dogL * PETS.dogL.lb;
  const petGal = ((petOzDay * DOG_OZ_PER_LB_DAY + cats * CAT_OZ_PER_DAY) / OZ_PER_GAL) * days;
  const waterGal = humanGal + petGal;
  const per = isBag ? 3.17 : 2.5; // 24 × 16.9 oz bottles = 3.17 gal
  let waterMath = `${humans} ${humans === 1 ? "person" : "people"} × 1 gal × ${days} days${heatX > 1 ? " × 2 for heat" : ""} = ${round1(humanGal)} gal`;
  if (petGal > 0) waterMath += `, plus ${round1(petGal)} gal for pets (dogs ~1 oz per lb a day, cats ~10 oz)`;
  waterMath += `. Total ${round1(waterGal)} gal ÷ ${per} gal per ${isBag ? "case" : "jug"}, rounded up.`;
  add({
    id: "water", cat: "Water and food", priority: -1, price: isBag ? "waterBag" : "water",
    name: "Water", need: waterGal, per, unit: isBag ? "case of 24 bottles" : "2.5-gallon jug",
    why: `One gallon per person per day, for drinking and keeping clean.${heatX > 1 ? " Doubled for heat." : ""}`, src: "redcross",
    math: waterMath, flag: heatX > 1 && fromAlert.heat ? "alert" : "",
    extra: isBag ? `That's about ${Math.round(waterGal * LB_PER_GAL)} lb of water. Split it across bags if it's too heavy to carry.` : "",
  });

  /* --- Food --- */
  const calDay = P.adults * CALORIES.adults + P.older * CALORIES.older + P.kids * CALORIES.kids;
  const calTotal = calDay * days;
  if (calTotal > 0) {
    const mix = isBag
      ? [["bars", "Granola or protein bars", 200, 12, "box of 12", 0.6],
         ["pb", "Peanut butter, 16 oz jar", 2600, 1, "jar", 0.2],
         ["trail", "Trail mix, 16 oz bag", 2400, 1, "bag", 0.2]]
      : [["cans", "Canned meals or soup", 400, 4, "4-pack of cans", 0.45],
         ["pb", "Peanut butter, 16 oz jar", 2600, 1, "jar", 0.25],
         ["bars", "Granola or protein bars", 200, 12, "box of 12", 0.3]];
    mix.forEach(([id, name, cal, packSize, unit, share]) => {
      const units = Math.ceil((calTotal * share) / cal);
      add({
        id, cat: "Water and food", priority: 1, price: id, name, need: units, per: packSize, unit,
        why: id === "pb" ? "Lots of calories, no cooking. Swap for a nut-free spread if anyone's allergic." : "Food you can eat without cooking, since power or gas may be out.",
        src: "redcross",
        math: `${calDay.toLocaleString()} calories a day × ${days} days = ${calTotal.toLocaleString()}. ${Math.round(share * 100)}% from this = ${Math.round(calTotal * share).toLocaleString()} ÷ ${cal} per ${id === "cans" ? "can" : id === "bars" ? "bar" : id === "pb" ? "jar" : "bag"} = ${units}${packSize > 1 ? `, sold in ${packSize}s` : ""}.`,
      });
    });
    if (!isBag) add({ id: "opener", cat: "Water and food", priority: 2, price: "opener", name: "Manual can opener", need: 1, per: 1, unit: "opener", why: "For the canned food when the power's out.", src: "ready" });
  }

  /* --- Babies and pets --- */
  if (P.babies > 0) {
    add({ id: "formula", cat: "Babies and pets", priority: 1, price: "formula", name: "Formula and bottles", need: days * P.babies, per: 1, unit: "day's supply",
      buy: `${days} days of your baby's usual formula${P.babies > 1 ? ", for each baby" : ""}`, why: "Stores may be closed or out of stock. Price is a rough per-day estimate.", src: "ready" });
    const diapers = 8 * days * P.babies;
    add({ id: "diapers", cat: "Babies and pets", priority: 1, price: "diapers", name: "Diapers", need: diapers, per: 40, unit: "pack of 40",
      why: "Plus wipes and rash cream.", src: "ready", math: `About 8 a day × ${days} days × ${P.babies} = ${diapers}, sold in 40s.` });
  }
  if (dogs + cats > 0) {
    const pets = dogs + cats;
    add({ id: "petfood", cat: "Babies and pets", priority: 1, price: "petfood", name: "Pet food", need: days * pets, per: 1, unit: "pet-day",
      buy: `${days} days of their usual food for ${plural(pets, "pet")}`, why: "Their water is already counted in the water line. Price is a rough per-day estimate.", src: "ready" });
    if (isBag) add({ id: "leash", cat: "Babies and pets", priority: 2, price: "leash", name: "Leash or carrier", need: pets, per: 1, unit: "each",
      why: "Shelters and hotels usually need pets leashed or crated.", src: null });
  }

  /* --- Light and power --- */
  if (nonBaby > 0) {
    add({ id: "flashlight", cat: "Light and power", priority: 2, price: "flashlight", name: "Flashlights", need: nonBaby, per: 2, unit: "2-pack",
      why: "One per person, so nobody's stuck in the dark.", src: "ready", math: `1 each × ${nonBaby} = ${nonBaby}, sold in pairs.` });
    const battX = has("outage") ? 2 : 1;
    const batts = nonBaby * days * battX;
    add({ id: "batteries", cat: "Light and power", priority: 2, price: "batteries", name: "AA batteries", need: batts, per: 24, unit: "24-pack",
      why: `Spares for flashlights and the radio.${battX > 1 ? " Doubled for power outages." : ""}`, src: "ready",
      math: `1 a day × ${nonBaby} ${nonBaby === 1 ? "person" : "people"} × ${days} days${battX > 1 ? " × 2" : ""} = ${batts}, sold in 24s.` });
  }
  add({ id: "radio", cat: "Light and power", priority: 2, price: "radio", name: "Hand-crank NOAA weather radio", need: 1, per: 1, unit: "radio",
    why: "Gets emergency broadcasts when phones and power are down.", src: "ready" });
  if (grownUps > 0) add({ id: "powerbank", cat: "Light and power", priority: 3, price: "powerbank", name: "Phone power bank", need: grownUps, per: 1, unit: "power bank",
    why: "One per adult, kept charged.", src: "ready" });

  /* --- First aid and health --- */
  add({ id: "firstaid", cat: "First aid and health", priority: 2, price: "firstaid", name: "First aid kit", need: Math.max(1, humans), per: 4, unit: "kit (covers 4 people)",
    why: "Bandages, gauze, antiseptic, gloves.", src: "ready" });
  add({ id: "meds", cat: "First aid and health", priority: 1, reminder: true, name: "Prescription medications",
    buy: "Keep a 7-day supply of everyone's prescriptions", why: "Pharmacies may be closed after a disaster.", src: "redcross" });
  add({ id: "otc", cat: "First aid and health", priority: 3, price: "otc", name: "Basic medicine", need: 1, per: 1, unit: "set",
    why: "Pain reliever, anti-diarrhea medicine, antacids.", src: "ready" });
  if (nonBaby > 0) {
    const maskX = has("wildfire") ? days : 2;
    add({ id: "masks", cat: "First aid and health", priority: has("wildfire") ? threatPriority("wildfire") : 3, price: "masks", name: "N95 masks", need: nonBaby * maskX, per: 10, unit: "10-pack",
      why: has("wildfire") ? `One per person per day for smoke. ${threatNote("wildfire")}` : "Filters dust and smoke. Two each.", src: "ready",
      flag: fromAlert.wildfire ? "alert" : "", math: `${nonBaby} × ${maskX} = ${nonBaby * maskX}, sold in 10s.` });
  }

  /* --- Tools and sanitation --- */
  if (nonBaby > 0) add({ id: "whistle", cat: "Tools and sanitation", priority: 4, price: "whistle", name: "Whistles", need: nonBaby, per: 3, unit: "3-pack",
    why: "To signal for help. One each.", src: "ready" });
  add({ id: "multitool", cat: "Tools and sanitation", priority: 4, price: "multitool", name: "Multi-tool or wrench", need: 1, per: 1, unit: "tool",
    why: "To turn off gas or water if officials tell you to.", src: "ready" });
  if (!isBag) add({ id: "sheeting", cat: "Tools and sanitation", priority: 4, price: "sheeting", name: "Plastic sheeting and duct tape", need: 1, per: 1, unit: "set",
    why: "To seal a room if you're told to shelter in place.", src: "ready" });
  add({ id: "wipes", cat: "Tools and sanitation", priority: 3, price: "wipes", name: "Wet wipes", need: humans * days, per: 10, unit: "pack (about 10 person-days)",
    why: "For staying clean if water is short.", src: "ready", math: `${humans} × ${days} days = ${humans * days} person-days, about 10 per pack.` });
  add({ id: "bags", cat: "Tools and sanitation", priority: 4, price: "bags", name: "Garbage bags with ties", need: Math.max(1, humans) * days, per: 30, unit: "box of 30",
    why: "For trash and sanitation.", src: "ready" });
  add({ id: "blankets", cat: "Tools and sanitation", priority: 3, price: "blankets", name: "Emergency blankets", need: Math.max(1, humans), per: 4, unit: "4-pack",
    why: "Foil blankets that hold in body heat. One each.", src: "redcross" });
  add({ id: "docs", cat: "Tools and sanitation", priority: 3, price: "docs", name: "Waterproof pouch for documents", need: 1, per: 1, unit: "pouch",
    why: "Copies of IDs, insurance, leases, and a list of everyone's medications.", src: "redcross" });
  add({ id: "map", cat: "Tools and sanitation", priority: 4, price: "map", name: "Paper map of your area", need: 1, per: 1, unit: "map",
    why: "In case phones and GPS are down.", src: "ready" });
  add({ id: "cash", cat: "Tools and sanitation", priority: 3, reminder: true, name: "Cash", buy: "Some small bills", why: "Card readers don't work without power.", src: "redcross" });

  /* --- For your area (threat-specific) --- */
  const A = "For your area";
  if (has("winter")) {
    add({ id: "warmers", cat: A, priority: threatPriority("winter"), price: "warmers", name: "Hand warmers", need: Math.max(1, nonBaby) * days, per: 10, unit: "10-pack",
      why: `One per person per day. ${threatNote("winter")}`, flag: fromAlert.winter ? "alert" : "", src: null });
    if (!isBag) add({ id: "icemelt", cat: A, priority: threatPriority("winter"), price: "icemelt", name: "Ice melt", need: 1, per: 1, unit: "bag", why: threatNote("winter"), flag: fromAlert.winter ? "alert" : "", src: null });
    add({ id: "layers", cat: A, priority: threatPriority("winter"), reminder: true, name: "Extra layers", buy: "Hats, gloves and a warm blanket for everyone", why: threatNote("winter"), flag: fromAlert.winter ? "alert" : "", src: null });
  }
  if (has("hurricane")) {
    add({ id: "tarp", cat: A, priority: threatPriority("hurricane"), price: "tarp", name: "Heavy-duty tarp", need: 1, per: 1, unit: "tarp", why: `For roof or window damage. ${threatNote("hurricane")}`, flag: fromAlert.hurricane ? "alert" : "", src: null });
    add({ id: "bin", cat: A, priority: threatPriority("hurricane"), price: "bin", name: "Waterproof bin", need: 1, per: 1, unit: "bin", why: `Keeps meds and documents dry. ${threatNote("hurricane")}`, flag: fromAlert.hurricane ? "alert" : "", src: null });
    add({ id: "gas", cat: A, priority: threatPriority("hurricane"), reminder: true, name: "Full gas tank", buy: "Fill up when a storm is forecast", why: "Gas stations close or run out before landfall.", flag: fromAlert.hurricane ? "alert" : "", src: null });
  }
  if (has("heat")) {
    add({ id: "electrolytes", cat: A, priority: threatPriority("heat"), price: "electrolytes", name: "Electrolyte packets", need: Math.max(1, nonBaby) * days, per: 16, unit: "16-pack",
      why: `One per person per day. ${threatNote("heat")}`, flag: fromAlert.heat ? "alert" : "", src: null });
    add({ id: "fan", cat: A, priority: threatPriority("heat"), price: "fan", name: "Battery-powered fan", need: Math.max(1, humans), per: 2, unit: "fan (for 2 people)", why: threatNote("heat"), flag: fromAlert.heat ? "alert" : "", src: null });
    add({ id: "cooling", cat: A, priority: threatPriority("heat"), reminder: true, name: "Nearest cooling center", buy: "Look it up before you need it", why: "Your city or county lists them during heat waves.", flag: fromAlert.heat ? "alert" : "", src: null });
  }
  if (has("flood")) {
    add({ id: "drybag", cat: A, priority: threatPriority("flood"), price: "drybag", name: "Dry bag", need: 1, per: 1, unit: "bag", why: `Keeps phones, meds and papers dry. ${threatNote("flood")}`, flag: fromAlert.flood ? "alert" : "", src: null });
    add({ id: "high", cat: A, priority: threatPriority("flood"), reminder: true, name: "Move things up", buy: "Keep the kit and valuables off the floor", why: "Never walk or drive through floodwater.", flag: fromAlert.flood ? "alert" : "", src: null });
  }
  if (has("outage")) {
    add({ id: "lantern", cat: A, priority: threatPriority("outage"), price: "lantern", name: "Battery lantern", need: humans > 4 ? 2 : 1, per: 1, unit: "lantern", why: `Lights a whole room. Batteries are doubled too. ${threatNote("outage")}`, flag: fromAlert.outage ? "alert" : "", src: null });
    if (!isBag) add({ id: "cooler", cat: A, priority: 3, price: "cooler", name: "Cooler", need: 1, per: 1, unit: "cooler", why: "Keeps food and meds cold for a day or two.", flag: fromAlert.outage ? "alert" : "", src: null });
  }
  if (has("tornado")) {
    add({ id: "saferoom", cat: A, priority: threatPriority("tornado"), reminder: true, name: "Pick your safe spot", buy: "Lowest floor, interior room, no windows", why: threatNote("tornado"), flag: fromAlert.tornado ? "alert" : "", src: null });
    add({ id: "shoes", cat: A, priority: threatPriority("tornado"), reminder: true, name: "Shoes by every bed", buy: "Sturdy shoes and a flashlight", why: "For walking over glass and debris.", flag: fromAlert.tornado ? "alert" : "", src: null });
  }
  if (has("earthquake") && !has("tornado")) {
    add({ id: "shoes", cat: A, priority: 3, reminder: true, name: "Shoes by every bed", buy: "Sturdy shoes and a flashlight", why: `For walking over broken glass. ${threatNote("earthquake")}`, src: null });
  }
  if (has("wildfire")) {
    add({ id: "bagready", cat: A, priority: threatPriority("wildfire"), reminder: true, name: "Go-bag by the door", buy: "Keep it packed during fire season", why: `Evacuations can come with little warning. Masks are increased too. ${threatNote("wildfire")}`, flag: fromAlert.wildfire ? "alert" : "", src: null });
  }

  return { lines, days, humans, totals: totalsFor(lines), fromAlert, waterGal };
}

function totalsFor(lines) {
  const left = lines.filter((l) => !state.have[l.id]);
  return {
    cost: left.reduce((a, l) => a + l.cost, 0),
    itemsLeft: left.length,
    itemsAll: lines.length,
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

// "Buy 19 × 2.5-gallon jug", or just "Buy 2" when items are sold one at a time.
function buyText(l) {
  if (l.buy) return l.buy;
  return l.per === 1 ? `Buy ${l.packs}` : `Buy ${l.packs} × ${l.unit}`;
}

// Spread purchases over paychecks: most urgent first, roughly even totals.
function buildPlan(kit) {
  const n = Math.max(1, state.paychecks);
  const items = kit.lines.filter((l) => !state.have[l.id] && !l.reminder)
    .sort((a, b) => a.priority - b.priority || b.cost - a.cost);
  const total = items.reduce((a, l) => a + l.cost, 0);
  const target = total / n;
  const trips = Array.from({ length: n }, () => ({ items: [], total: 0 }));
  let t = 0;
  items.forEach((it) => {
    if (t < n - 1 && trips[t].items.length && trips[t].total + it.cost > target * 1.1) t++;
    trips[t].items.push(it);
    trips[t].total += it.cost;
  });
  return { trips: trips.filter((tr) => tr.items.length), total, target };
}

/* ================= 5. RENDER ================= */

function renderInputs() {
  $("peopleList").innerHTML = Object.entries(PEOPLE).map(([k, p]) => counterRow("people", k, p.label, p.note, state.people[k])).join("");
  $("petList").innerHTML = Object.entries(PETS).map(([k, p]) => counterRow("pets", k, p.label, p.note, state.pets[k])).join("");

  document.querySelectorAll("#kitSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kit === state.kit)));
  document.querySelectorAll("#daysSeg button").forEach((b) => {
    const isBag = state.kit === "bag";
    b.disabled = isBag;
    b.setAttribute("aria-pressed", String(isBag ? b.dataset.days === "3" : Number(b.dataset.days) === state.days));
  });
  $("kitHint").textContent = state.kit === "bag"
    ? "A go-bag is what you grab if you have to leave. It covers 3 days and leaves out heavy stuff."
    : "A home kit is for riding things out where you live. The Red Cross suggests 2 weeks.";

  const fa = alertThreats();
  $("threatChips").innerHTML = Object.entries(THREATS).map(([k, t]) => {
    const on = state.threats.includes(k) || !!fa[k];
    return `<button type="button" class="chip ${fa[k] ? "from-alert" : ""}" data-threat="${k}" aria-pressed="${on}"
      ${fa[k] ? `title="Switched on by the ${esc(fa[k])}"` : ""}>${t.label}</button>`;
  }).join("");
}

function counterRow(group, key, label, note, n) {
  return `<li class="counter">
    <span class="counter-label">${label}${note ? `<small>${note}</small>` : ""}</span>
    <span class="stepper">
      <button type="button" data-group="${group}" data-key="${key}" data-step="-1" aria-label="One fewer: ${label}">−</button>
      <output>${n}</output>
      <button type="button" data-group="${group}" data-key="${key}" data-step="1" aria-label="One more: ${label}">+</button>
    </span>
  </li>`;
}

function renderLocationStatus(msg, isError) {
  const el = $("locStatus");
  el.classList.toggle("is-error", !!isError);
  if (msg) { el.innerHTML = msg; return; }
  el.innerHTML = state.location ? `Checking alerts for <strong>${esc(state.location.label)}</strong>.` : "";
}

function renderAlerts(status) {
  const box = $("alerts");
  if (!state.location) {
    box.innerHTML = `<div class="alert-box empty"><div class="alert-head"><h2>Live weather alerts</h2></div>
      <p class="alert-meta" style="margin:6px 0 0">Add where you live and Ready checks the National Weather Service for alerts, then adjusts your kit.</p></div>`;
    return;
  }
  const items = liveAlerts();
  const when = state.alerts && state.alerts.fetchedAt ? fmtTime(state.alerts.fetchedAt) : "";
  let meta = "";
  if (status === "loading") meta = "Checking now…";
  else if (status === "offline") meta = when ? `You're offline. Showing what was active as of ${when}.` : "You're offline. Connect to check for alerts.";
  else if (status === "error") meta = "Couldn't reach the National Weather Service. Try again in a minute.";
  else if (status === "outside") meta = "Weather alerts only cover the US.";
  else if (when) meta = `Checked ${when}.`;

  const refresh = `<button type="button" class="link-btn" id="refreshAlerts">Check again</button>`;

  if (!items.length) {
    box.innerHTML = `<div class="alert-box ${status === "error" || status === "outside" ? "empty" : "none"}">
      <div class="alert-head"><h2>No active alerts for ${esc(state.location.label)}</h2>${refresh}</div>
      <p class="alert-meta" style="margin:4px 0 0">${meta}</p></div>`;
    return;
  }
  const worst = items.some((a) => alertLevel(a.event) === "warn") ? "warn" : items.some((a) => alertLevel(a.event) === "watch") ? "watch" : "advisory";
  const fa = alertThreats();
  const added = Object.keys(fa).map((k) => THREATS[k].label.toLowerCase());
  box.innerHTML = `<div class="alert-box ${worst}">
    <div class="alert-head"><h2>${plural(items.length, "active alert")} for ${esc(state.location.label)}</h2>${refresh}</div>
    <ul class="alert-list">${items.map((a) => `
      <li class="alert-item ${alertLevel(a.event)}">
        <div class="alert-event">${esc(a.event)}</div>
        <div class="alert-meta">${a.ends ? `Until ${esc(fmtTime(a.ends))}. ` : ""}${esc(a.sender)}</div>
      </li>`).join("")}</ul>
    ${added.length ? `<p class="alert-added">Your kit now includes extra supplies for ${added.join(" and ")}.</p>` : ""}
    <p class="alert-meta" style="margin:6px 0 0">${meta}</p>
  </div>`;
}

function describeHousehold() {
  const parts = [];
  const P = state.people;
  if (P.adults) parts.push(plural(P.adults, "adult"));
  if (P.older) parts.push(plural(P.older, "older adult"));
  if (P.kids) parts.push(plural(P.kids, "kid"));
  if (P.babies) parts.push(plural(P.babies, "baby", "babies"));
  const dogs = state.pets.dogS + state.pets.dogM + state.pets.dogL;
  if (dogs) parts.push(plural(dogs, "dog"));
  if (state.pets.cats) parts.push(plural(state.pets.cats, "cat"));
  if (!parts.length) return "nobody yet";
  return parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0];
}

function upkeepStatus(u) {
  const last = state.upkeep[u.id];
  if (!last) return { cls: "unset", text: "Not set yet" };
  const d = new Date(last + "T00:00:00");
  const due = new Date(d); due.setMonth(due.getMonth() + u.months);
  const days = Math.round((due - startOfToday()) / 86400000);
  const dueText = due.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (days < 0) return { cls: "late", text: `Overdue since ${dueText}` };
  if (days <= 30) return { cls: "soon", text: `Due ${dueText}, in ${plural(days, "day")}` };
  return { cls: "ok", text: `Next check ${dueText}` };
}

function startOfToday() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function todayISO() { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; }

function renderSummary(kit) {
  const late = UPKEEP.filter((u) => upkeepStatus(u).cls === "late").length;
  $("summary").innerHTML = `
    <div class="tag-band" aria-hidden="true"></div>
    <div class="tag-body">
      <p class="tag-for">${state.kit === "bag" ? "Go-bag" : "Home kit"} for ${esc(describeHousehold())}</p>
      <div class="tag-grid">
        <div class="stat"><span class="stat-num">${Math.ceil(kit.waterGal)}</span><span class="stat-label">gallons of water</span></div>
        <div class="stat"><span class="stat-num">${kit.days}</span><span class="stat-label">days covered</span></div>
        <div class="stat"><span class="stat-num">${roundMoney(kit.totals.cost)}</span><span class="stat-label">left to buy</span></div>
        <div class="stat"><span class="stat-num">${kit.totals.itemsLeft}</span><span class="stat-label">of ${kit.totals.itemsAll} items to go</span></div>
      </div>
      ${late ? `<p class="tag-note">${plural(late, "part")} of your kit ${late === 1 ? "is" : "are"} overdue for a check. See Upkeep.</p>` : ""}
    </div>`;
}

function renderKit(kit) {
  if (!kit.lines.length) {
    $("panel-kit").innerHTML = `<h3>Kit list</h3><p class="panel-intro">Add at least one person or pet on the left and your kit shows up here.</p>`;
    return;
  }
  const order = ["For your area", "Water and food", "Babies and pets", "First aid and health", "Light and power", "Tools and sanitation"];
  const cats = order.map((c) => [c, kit.lines.filter((l) => l.cat === c)]).filter(([, ls]) => ls.length);

  $("panel-kit").innerHTML = `
    <div class="panel-head">
      <h3>Kit list</h3>
      <label class="toggle"><input type="checkbox" id="showMath" ${state.showMath ? "checked" : ""}> Show the math</label>
    </div>
    <p class="panel-intro">Check off what you already have and it drops out of the total. Prices are rough, so change them to match your store.</p>
    ${orderCats(cats, kit).map(([c, ls]) => `
      <div class="cat ${c === "For your area" ? "area" : ""}">
        <h4>${c}</h4>
        ${ls.map(itemRow).join("")}
      </div>`).join("")}
    <div class="kit-actions">
      <button type="button" class="link-btn" id="copyList">Copy shopping list</button>
      <button type="button" class="link-btn" id="resetPrices">Reset prices</button>
    </div>`;
}

// "For your area" goes first when a live alert added items, last otherwise.
function orderCats(cats, kit) {
  const area = cats.filter(([c]) => c === "For your area");
  const rest = cats.filter(([c]) => c !== "For your area");
  return Object.keys(kit.fromAlert).length ? [...area, ...rest] : [...rest, ...area];
}

function itemRow(l) {
  const have = !!state.have[l.id];
  const buy = buyText(l);
  const cost = l.reminder
    ? `<span>No cost</span>`
    : `<strong>${roundMoney(l.cost)}</strong>
       <label class="price">$<input type="number" min="0" step="0.5" value="${priceOf(l.price)}" data-price="${l.price}" aria-label="Price per ${esc(l.unit)} for ${esc(l.name)}"> each</label>`;
  return `<div class="item ${have ? "is-have" : ""} ${l.reminder ? "is-reminder" : ""}">
    <input type="checkbox" data-have="${l.id}" ${have ? "checked" : ""} aria-label="${l.reminder ? "Done" : "Already have"}: ${esc(l.name)}">
    <div>
      <div class="item-name">${esc(l.name)}${l.flag === "alert" ? `<span class="item-flag">Alert</span>` : ""}</div>
      <div class="item-buy">${esc(buy)}</div>
      <div class="item-why">${esc(l.why)}${l.extra ? " " + esc(l.extra) : ""}${sourceLink(l.src)}</div>
      ${state.showMath && l.math ? `<span class="item-math">${esc(l.math)}</span>` : ""}
    </div>
    <div class="item-cost">${cost}</div>
  </div>`;
}

function renderPlan(kit) {
  const plan = buildPlan(kit);
  const steps = [1, 2, 3, 4, 6];
  $("panel-plan").innerHTML = `
    <div class="panel-head"><h3>Buying plan</h3></div>
    <p class="panel-intro">Don't have ${roundMoney(plan.total)} right now? Spread it out. The most urgent things come first: water, food and anything a live alert added.</p>
    <div class="plan-controls">
      <span>Split over</span>
      <div class="seg" role="group" aria-label="Number of paychecks" id="paySeg">
        ${steps.map((n) => `<button type="button" data-pay="${n}" aria-pressed="${state.paychecks === n}">${n}</button>`).join("")}
      </div>
      <span>${state.paychecks === 1 ? "paycheck" : "paychecks"}</span>
    </div>
    ${plan.trips.length ? plan.trips.map((tr, i) => `
      <div class="trip">
        <div class="trip-head"><h4>${plan.trips.length === 1 ? "One trip" : `Paycheck ${i + 1}`}</h4><span class="trip-total">${roundMoney(tr.total)}</span></div>
        <ul>${tr.items.map((it) => `<li>${esc(it.name)} <span>${esc((it.buy || `${it.packs} × ${it.unit}`))}, ${roundMoney(it.cost)}</span></li>`).join("")}</ul>
      </div>`).join("") : `<p class="panel-intro">Nothing left to buy. You're set.</p>`}`;
}

function renderUpkeep() {
  $("panel-upkeep").innerHTML = `
    <div class="panel-head"><h3>Upkeep</h3></div>
    <p class="panel-intro">A kit only helps if it still works. Put in when you last checked each part and Ready tells you when it's due again.</p>
    ${UPKEEP.map((u) => {
      const s = upkeepStatus(u);
      return `<div class="upkeep-row">
        <div><h4>${u.label}</h4><p class="upkeep-note">${u.note}${sourceLink(u.src)}</p></div>
        <label><span class="sr-only">Last checked: ${u.label}</span><input type="date" data-upkeep="${u.id}" value="${state.upkeep[u.id] || ""}" max="${todayISO()}"></label>
        <button type="button" class="btn btn-quiet" data-checked="${u.id}">Checked today</button>
        <span class="pill ${s.cls}">${s.text}</span>
      </div>`;
    }).join("")}`;
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === state.tab)));
  ["kit", "plan", "upkeep"].forEach((k) => ($("panel-" + k).hidden = k !== state.tab));
}

function renderAll(alertStatus) {
  const kit = computeKit();
  renderInputs();
  renderAlerts(alertStatus);
  renderSummary(kit);
  renderKit(kit);
  renderPlan(kit);
  renderUpkeep();
  renderTabs();
  saveState();
}

/* ================= 6. EVENTS ================= */

let lastAlertStatus = "";

async function refreshAlerts() {
  if (!state.location) return;
  if (!navigator.onLine) { lastAlertStatus = "offline"; renderAll(lastAlertStatus); return; }
  renderAlerts("loading");
  try {
    const items = await fetchAlerts(state.location.lat, state.location.lon);
    state.alerts = { items, fetchedAt: new Date().toISOString() };
    lastAlertStatus = "";
  } catch (e) {
    lastAlertStatus = e.message === "outside-us" ? "outside" : navigator.onLine ? "error" : "offline";
    if (lastAlertStatus === "outside") state.alerts = { items: [], fetchedAt: new Date().toISOString() };
  }
  renderAll(lastAlertStatus);
}

async function setLocation(loc) {
  state.location = loc;
  state.alerts = null;
  renderLocationStatus();
  await refreshAlerts();
}

function bindEvents() {
  // Household counters (people + pets share one handler)
  document.querySelector(".panel").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (b) {
      const group = state[b.dataset.group];
      group[b.dataset.key] = Math.max(0, Math.min(20, (group[b.dataset.key] || 0) + Number(b.dataset.step)));
      renderAll(lastAlertStatus);
      return;
    }
    const kitBtn = e.target.closest("[data-kit]");
    if (kitBtn) { state.kit = kitBtn.dataset.kit; renderAll(lastAlertStatus); return; }
    const dayBtn = e.target.closest("[data-days]");
    if (dayBtn && !dayBtn.disabled) { state.days = Number(dayBtn.dataset.days); renderAll(lastAlertStatus); return; }
    const chip = e.target.closest("[data-threat]");
    if (chip) {
      const k = chip.dataset.threat;
      if (alertThreats()[k]) return; // switched on by a live alert, can't turn off
      state.threats = state.threats.includes(k) ? state.threats.filter((t) => t !== k) : [...state.threats, k];
      renderAll(lastAlertStatus);
    }
  });

  // Location search (only on submit, per Nominatim's rules)
  let lastSearch = 0;
  $("locForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("locInput").value.trim();
    if (!q) { renderLocationStatus("Type a city or ZIP code first.", true); return; }
    if (Date.now() - lastSearch < 1100) return;
    lastSearch = Date.now();
    const btn = $("locFind");
    btn.disabled = true;
    renderLocationStatus("Looking that up…");
    try {
      const loc = await searchPlace(q);
      $("locInput").value = "";
      await setLocation(loc);
    } catch (err) {
      renderLocationStatus(err.message === "not-found"
        ? `Couldn't find "${esc(q)}" in the US. Try a ZIP code or "City, ST".`
        : "Couldn't search right now. Check your connection and try again.", true);
    } finally {
      btn.disabled = false;
    }
  });

  $("locGeo").addEventListener("click", () => {
    if (!navigator.geolocation) { renderLocationStatus("This browser can't share your location. Type a city or ZIP instead.", true); return; }
    renderLocationStatus("Finding you…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const label = await nameForPoint(lat, lon);
      await setLocation({ lat, lon, label });
    }, () => renderLocationStatus("Location is off for this site. Type a city or ZIP instead.", true), { timeout: 10000, maximumAge: 600000 });
  });

  $("alerts").addEventListener("click", (e) => { if (e.target.id === "refreshAlerts") refreshAlerts(); });

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    state.tab = t.dataset.tab;
    renderTabs();
    saveState();
  });

  // Kit list
  const kitPanel = $("panel-kit");
  kitPanel.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "showMath") state.showMath = t.checked;
    else if (t.dataset.have) state.have[t.dataset.have] = t.checked;
    else if (t.dataset.price) {
      const v = parseFloat(t.value);
      if (!isNaN(v) && v >= 0) state.prices[t.dataset.price] = v;
    }
    renderAll(lastAlertStatus);
  });
  kitPanel.addEventListener("click", (e) => {
    if (e.target.id === "resetPrices") { state.prices = {}; renderAll(lastAlertStatus); }
    if (e.target.id === "copyList") copyList(e.target);
  });

  // Buying plan
  $("panel-plan").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pay]");
    if (b) { state.paychecks = Number(b.dataset.pay); renderAll(lastAlertStatus); }
  });

  // Upkeep
  const up = $("panel-upkeep");
  up.addEventListener("change", (e) => {
    if (e.target.dataset.upkeep) { state.upkeep[e.target.dataset.upkeep] = e.target.value; renderAll(lastAlertStatus); }
  });
  up.addEventListener("click", (e) => {
    const b = e.target.closest("[data-checked]");
    if (b) { state.upkeep[b.dataset.checked] = todayISO(); renderAll(lastAlertStatus); }
  });

  window.addEventListener("online", refreshAlerts);
}

function copyList(btn) {
  const kit = computeKit();
  const rows = kit.lines.filter((l) => !state.have[l.id]).map((l) => `- ${l.name}: ${(l.buy || `${l.packs} × ${l.unit}`)}${l.reminder ? "" : ` (${roundMoney(l.cost)})`}`);
  const text = `Ready kit shopping list\n${rows.join("\n")}\nTotal: ${roundMoney(kit.totals.cost)}`;
  const done = () => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy shopping list"), 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => window.prompt("Copy this:", text));
  else window.prompt("Copy this:", text);
}

/* ================= START ================= */
bindEvents();
renderLocationStatus();
renderAll(state.location && !navigator.onLine ? "offline" : "");
if (state.location) refreshAlerts();
