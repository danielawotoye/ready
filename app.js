/* ============================================================
   Ready: emergency kit planner
   ------------------------------------------------------------
   1. CONSTANTS  - the numbers behind the kit. Tune these.
   2. STATE      - what the user picked, saved on this device.
   3. APIs       - Nominatim (place search) and the National
                   Weather Service (live alerts).
   4. ENGINE     - turns the household into a kit list.
   5. SCREENS    - one function per screen, plus the router.
   6. EVENTS     - one click/change/submit listener for the whole app.
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

// v2 interface numbers.
const DEFAULT_DAYS = 3;                      // the first answer people see
const EXTEND_DAYS = 14;                      // what "Make it 2 weeks" jumps to
const DAY_OPTIONS = [3, 7, 14];              // choices on the Tune screen
const DAY_LABELS = { 3: "3 days", 7: "1 week", 14: "2 weeks" };
const PAYCHECK_OPTIONS = [1, 2, 3, 4, 6];    // buying-plan splits
const SETUP_STEPS = 4;
const SEARCH_GAP_MS = 1100;                  // Nominatim: max 1 request per second

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
    days: DEFAULT_DAYS,
    threats: [],
    location: null,                   // { lat, lon, label }
    alerts: null,                     // { items: [...], fetchedAt, label }
    have: {},
    prices: {},
    showMath: false,
    paychecks: 3,
    upkeep: {},
    setupDone: false,                 // has the person finished the 4 setup screens?
    editPrices: false,                // price boxes are hidden until asked for
    openCats: {},                     // which kit-list categories are expanded
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const d = defaultState();
    const merged = { ...d, ...saved, people: { ...d.people, ...saved.people }, pets: { ...d.pets, ...saved.pets } };
    // v1 saves have no setupDone and a 14-day default nobody chose. Start v2 at 3 days.
    if (!saved.setupDone) merged.days = DEFAULT_DAYS;
    return merged;
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

/* ================= 5. SCREENS ================= */

// Routes are the part of the address after "#": #/setup/2, #/home, #/list ...
// Links are plain <a href="#/list">, so the phone's Back button just works.
const ROUTES = ["setup", "home", "list", "plan", "upkeep", "tune", "about"];
const FOOD_IDS = ["cans", "pb", "bars", "trail"];

const app = $("app");
let alertStatus = state.location && !navigator.onLine ? "offline" : ""; // "", loading, offline, error, outside
let locNote = null;   // message under the location box: { msg, err }
let locDraft = "";    // what's typed in the location box, kept across redraws
let locBusy = false;
let lastSearch = 0;

const sayList = (parts) => (parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0] || "");

function route() {
  const [name = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  return { name, n: Math.min(SETUP_STEPS, Math.max(1, Number(arg) || 1)) };
}

function go(path) { location.hash = "#/" + path; }

/* ---------- small pieces ---------- */

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
  return parts.length ? sayList(parts) : "nobody yet";
}

function startOfToday() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function todayISO() { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; }

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

function counterRow(group, key, label, note, n) {
  return `<li class="counter">
    <span class="counter-label">${label}${note ? `<small>${note}</small>` : ""}</span>
    <span class="stepper">
      <button type="button" data-action="step" data-group="${group}" data-key="${key}" data-step="-1" aria-label="One fewer: ${label}">−</button>
      <output>${n}</output>
      <button type="button" data-action="step" data-group="${group}" data-key="${key}" data-step="1" aria-label="One more: ${label}">+</button>
    </span>
  </li>`;
}

const back = (href, label) => `<a class="back" href="${href}">← ${label || "Back"}</a>`;

// The one-sentence answer. Only counts what's still left to buy.
function headline(kit) {
  if (!kit.lines.length) return `Add a person or pet to see your kit.`;
  const left = kit.lines.filter((l) => !state.have[l.id]);
  if (!left.length) return `You've got everything. Nice. Keep it fresh so it still works when you need it.`;
  const num = (n) => `<strong class="num">${n}</strong>`;
  const parts = [];
  if (left.some((l) => l.id === "water")) {
    const g = Math.ceil(kit.waterGal);
    parts.push(`${num(g)} ${g === 1 ? "gallon" : "gallons"} of water`);
  }
  if (left.some((l) => FOOD_IDS.includes(l.id))) parts.push(`food for ${num(kit.days)} days`);
  const other = left.filter((l) => l.id !== "water" && !FOOD_IDS.includes(l.id)).length;
  if (other) parts.push(`${num(other)} other ${other === 1 ? "thing" : "things"}`);
  const tail = kit.totals.cost > 0 ? `, about ${num(roundMoney(kit.totals.cost))}` : `. Nothing to buy.`;
  return `You need ${sayList(parts)}${tail}${kit.totals.cost > 0 ? "." : ""}`;
}

/* ---------- alerts: loud only when one is active ---------- */

function alertMeta() {
  const when = state.alerts && state.alerts.fetchedAt ? fmtTime(state.alerts.fetchedAt) : "";
  if (alertStatus === "loading") return "Checking now…";
  if (alertStatus === "offline") return when ? `You're offline. Showing what was active as of ${when}.` : "You're offline. Connect to check for alerts.";
  if (alertStatus === "error") return "Couldn't reach the National Weather Service. Try again in a minute.";
  if (alertStatus === "outside") return "Weather alerts only cover the US.";
  return when ? `Checked ${when}.` : "";
}

function alertBanner(r) {
  const items = liveAlerts();
  if (!items.length || !state.location) return "";
  const worst = items.some((a) => alertLevel(a.event) === "warn") ? "warn" : items.some((a) => alertLevel(a.event) === "watch") ? "watch" : "advisory";
  const added = Object.keys(alertThreats()).map((k) => THREATS[k].label.toLowerCase());
  return `<div class="banner ${worst}" role="status">
    <div class="banner-head"><strong>${plural(items.length, "active alert")} for ${esc(state.location.label)}</strong>
      <button type="button" class="link-btn" data-action="refresh">Check again</button></div>
    <ul class="alert-list">${items.map((a) => `
      <li class="alert-item ${alertLevel(a.event)}">
        <div class="alert-event">${esc(a.event)}</div>
        <div class="alert-meta">${a.ends ? `Until ${esc(fmtTime(a.ends))}. ` : ""}${esc(a.sender)}</div>
      </li>`).join("")}</ul>
    ${added.length ? `<p class="banner-added">Your kit now includes extra supplies for ${added.join(" and ")}.${r.name !== "list" ? ` <a href="#/list">See them</a>` : ""}</p>` : ""}
    <p class="alert-meta">${alertMeta()}</p>
  </div>`;
}

// No alerts: one quiet line on the answer screen, nothing anywhere else.
function quietStatus() {
  if (!state.location || liveAlerts().length) return "";
  const when = state.alerts && state.alerts.fetchedAt ? fmtTime(state.alerts.fetchedAt) : "";
  const label = esc(state.location.label);
  let msg = "";
  if (alertStatus === "loading") msg = "Checking alerts…";
  else if (alertStatus === "offline") msg = when ? `Offline. No alerts for ${label} as of ${when}.` : "Offline. Connect to check for alerts.";
  else if (alertStatus === "error") msg = "Couldn't reach the National Weather Service.";
  else if (alertStatus === "outside") msg = "Weather alerts only cover the US.";
  else if (when) msg = `No active alerts for ${label}. Checked ${when}.`;
  return msg ? `<p class="quiet">${msg} <button type="button" class="link-btn" data-action="refresh">Check again</button></p>` : "";
}

/* ---------- setup: one question per screen ---------- */

function screenSetup(n) {
  const dots = Array.from({ length: SETUP_STEPS }, (_, i) => `<span class="dot ${i < n ? "on" : ""}"></span>`).join("");
  const progress = `<div class="progress"><span>Step ${n} of ${SETUP_STEPS}</span><span class="dots" aria-hidden="true">${dots}</span></div>`;
  const humans = state.people.adults + state.people.older + state.people.kids + state.people.babies;
  const petsTotal = Object.values(state.pets).reduce((a, b) => a + b, 0);
  const leftBtn = n === 1
    ? (state.setupDone ? `<a class="btn btn-quiet big" href="#/home">Cancel</a>` : `<span></span>`)
    : `<a class="btn btn-quiet big" href="#/setup/${n - 1}">Back</a>`;
  const nav = (right) => `<div class="nav">${leftBtn}${right}</div>`;

  if (n === 1) {
    return `<section class="screen">${progress}
      <h1 tabindex="-1">Who's in your household?</h1>
      <p class="lede">Adults, kids and babies each need different things.</p>
      <ul class="counters">${Object.entries(PEOPLE).map(([k, p]) => counterRow("people", k, p.label, p.note, state.people[k])).join("")}</ul>
      ${humans ? "" : `<p class="hint">Add at least one person to go on.</p>`}
      ${nav(humans ? `<a class="btn big" href="#/setup/2">Next</a>` : `<button type="button" class="btn big" disabled>Next</button>`)}
    </section>`;
  }
  if (n === 2) {
    return `<section class="screen">${progress}
      <h1 tabindex="-1">Any pets?</h1>
      <p class="lede">Their water and food get added to your kit.</p>
      <ul class="counters">${Object.entries(PETS).map(([k, p]) => counterRow("pets", k, p.label, p.note, state.pets[k])).join("")}</ul>
      ${nav(`<a class="btn big" href="#/setup/3">${petsTotal ? "Next" : "No pets"}</a>`)}
    </section>`;
  }
  if (n === 3) {
    const status = locNote ? locNote.msg : state.location ? `Using <strong>${esc(state.location.label)}</strong>.` : "";
    return `<section class="screen">${progress}
      <h1 tabindex="-1">Where do you live?</h1>
      <p class="lede">Ready checks the National Weather Service for alerts there and adds what you'd need. You can skip this.</p>
      <form class="loc-form" id="locForm">
        <label class="sr-only" for="locInput">City or ZIP code</label>
        <input type="text" id="locInput" placeholder="City or ZIP code" autocomplete="postal-code" enterkeyhint="search" value="${esc(locDraft)}">
        <button type="submit" class="btn" ${locBusy ? "disabled" : ""}>Find</button>
      </form>
      <button type="button" class="link-btn" data-action="geo">Use my location</button>
      <p class="loc-status ${locNote && locNote.err ? "is-error" : ""}" aria-live="polite">${status}</p>
      <p class="hint">Place search by <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noopener">Nominatim</a>, data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>.</p>
      ${nav(`<a class="btn big" href="#/setup/4">${state.location ? "Next" : "Skip for now"}</a>`)}
    </section>`;
  }
  return `<section class="screen">${progress}
    <h1 tabindex="-1">What kind of kit?</h1>
    <div class="choices">
      <button type="button" class="choice" data-action="kit" data-kit="home" aria-pressed="${state.kit === "home"}">
        <strong>Home kit</strong><span>For riding things out where you live. Starts at ${DAY_LABELS[DEFAULT_DAYS]}, and you can extend it.</span></button>
      <button type="button" class="choice" data-action="kit" data-kit="bag" aria-pressed="${state.kit === "bag"}">
        <strong>Go-bag</strong><span>What you grab if you have to leave. ${DAY_LABELS[DEFAULT_DAYS]}, lighter things you can carry.</span></button>
    </div>
    ${nav(`<button type="button" class="btn big" data-action="finish">Show my kit</button>`)}
  </section>`;
}

/* ---------- answer screen ---------- */

function screenHome(kit) {
  const plan = buildPlan(kit);
  const sts = UPKEEP.map(upkeepStatus);
  const late = sts.filter((s) => s.cls === "late").length;
  const soon = sts.filter((s) => s.cls === "soon").length;
  const unset = sts.filter((s) => s.cls === "unset").length;
  const upkeepSub = late ? `<span class="row-sub warn">${plural(late, "check")} overdue</span>`
    : soon ? `<span class="row-sub">${plural(soon, "check")} due soon</span>`
    : unset === sts.length ? `<span class="row-sub">Track when things expire</span>`
    : `<span class="row-sub">All up to date</span>`;
  const extend = state.kit === "home" && kit.lines.length
    ? (state.days < EXTEND_DAYS
        ? `<button type="button" class="btn btn-quiet" data-action="days" data-days="${EXTEND_DAYS}">Make it ${DAY_LABELS[EXTEND_DAYS]}</button>`
        : `<button type="button" class="btn btn-quiet" data-action="days" data-days="${DEFAULT_DAYS}">Back to ${DAY_LABELS[DEFAULT_DAYS]}</button>`)
    : "";
  const rows = kit.lines.length ? `
    <nav class="rows" aria-label="Details">
      <a class="row" href="#/list"><span class="row-title">See the list</span>
        <span class="row-sub">${kit.totals.itemsLeft} of ${kit.totals.itemsAll} items left to buy</span><span class="chev" aria-hidden="true">›</span></a>
      <a class="row" href="#/plan"><span class="row-title">Spread the cost</span>
        <span class="row-sub">${plan.total > 0 ? `Over ${plural(state.paychecks, "paycheck")}, about ${roundMoney(plan.target)} each` : "Nothing left to buy"}</span><span class="chev" aria-hidden="true">›</span></a>
      <a class="row" href="#/upkeep"><span class="row-title">Keep it fresh</span>
        ${upkeepSub}<span class="chev" aria-hidden="true">›</span></a>
    </nav>` : "";
  return `<section class="screen">
    <h1 class="sr-only" tabindex="-1">Your kit</h1>
    <div class="tag">
      <div class="tag-band" aria-hidden="true"></div>
      <div class="tag-body">
        <p class="tag-for">${state.kit === "bag" ? "Go-bag" : "Home kit"}, ${DAY_LABELS[kit.days] || plural(kit.days, "day")}, for ${esc(describeHousehold())}</p>
        <p class="answer">${headline(kit)}</p>
        ${extend}
      </div>
    </div>
    ${rows}
    <p class="links"><a href="#/tune">Tune for your area</a><a href="#/setup/1">Edit household</a></p>
    ${quietStatus()}
    <p class="quiet">A planning tool, not official guidance. In an emergency, follow local officials.</p>
  </section>`;
}

/* ---------- details screens ---------- */

// A category opens by hand, or on its own when a live alert added items to it.
function isOpen(cat) {
  if (state.openCats[cat] !== undefined) return state.openCats[cat];
  return cat === "For your area" && Object.keys(alertThreats()).length > 0;
}

function itemRow(l) {
  const have = !!state.have[l.id];
  const buy = buyText(l);
  const price = state.editPrices
    ? `<label class="price">$<input type="number" min="0" step="0.5" value="${priceOf(l.price)}" data-price="${l.price}" aria-label="Price per ${esc(l.unit)} for ${esc(l.name)}"> each</label>`
    : "";
  const cost = l.reminder ? `<span>No cost</span>` : `<strong>${roundMoney(l.cost)}</strong>${price}`;
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

function screenList(kit) {
  if (!kit.lines.length) return `<section class="screen">${back("#/home")}<h1 tabindex="-1">Your list</h1><p class="lede">Add a person or pet first and your list shows up here.</p></section>`;
  const order = ["For your area", "Water and food", "Babies and pets", "First aid and health", "Light and power", "Tools and sanitation"];
  const cats = order.map((c) => [c, kit.lines.filter((l) => l.cat === c)]).filter(([, ls]) => ls.length);
  const area = cats.filter(([c]) => c === "For your area");
  const rest = cats.filter(([c]) => c !== "For your area");
  const ordered = Object.keys(kit.fromAlert).length ? [...area, ...rest] : [...rest, ...area]; // alert items first
  return `<section class="screen">
    ${back("#/home")}
    <h1 tabindex="-1">Your list</h1>
    <p class="lede">${kit.totals.itemsLeft} left to buy, about ${roundMoney(kit.totals.cost)}. Tick what you already have and it drops out of the total.</p>
    <div class="toolbar">
      <label class="toggle"><input type="checkbox" id="showMath" ${state.showMath ? "checked" : ""}> Show the math</label>
      <label class="toggle"><input type="checkbox" id="editPrices" ${state.editPrices ? "checked" : ""}> Edit prices</label>
    </div>
    ${ordered.map(([c, ls]) => {
      const open = isOpen(c);
      return `<div class="cat ${c === "For your area" ? "area" : ""}">
        <button type="button" class="cat-head" data-action="cat" data-cat="${esc(c)}" aria-expanded="${open}">
          <span class="cat-name">${c}</span><span class="cat-meta">${ls.filter((l) => !state.have[l.id]).length} left</span><span class="chev" aria-hidden="true">›</span>
        </button>
        <div class="cat-body" ${open ? "" : "hidden"}>${ls.map(itemRow).join("")}</div>
      </div>`;
    }).join("")}
    <div class="kit-actions">
      <button type="button" class="link-btn" data-action="copy">Copy shopping list</button>
      ${state.editPrices ? `<button type="button" class="link-btn" data-action="reset-prices">Reset prices</button>` : ""}
    </div>
  </section>`;
}

function screenPlan(kit) {
  const plan = buildPlan(kit);
  return `<section class="screen">
    ${back("#/home")}
    <h1 tabindex="-1">Spread the cost</h1>
    <p class="lede">${plan.total > 0 ? `Don't have ${roundMoney(plan.total)} right now? Spread it out. The most urgent things come first: water, food and anything a live alert added.` : "Nothing left to buy. You're set."}</p>
    <div class="plan-controls">
      <span>Split over</span>
      <div class="seg" role="group" aria-label="Number of paychecks">
        ${PAYCHECK_OPTIONS.map((n) => `<button type="button" data-action="pay" data-pay="${n}" aria-pressed="${state.paychecks === n}">${n}</button>`).join("")}
      </div>
      <span>${state.paychecks === 1 ? "paycheck" : "paychecks"}</span>
    </div>
    ${plan.trips.map((tr, i) => `
      <div class="trip">
        <div class="trip-head"><h2>${plan.trips.length === 1 ? "One trip" : `Paycheck ${i + 1}`}</h2><span class="trip-total">${roundMoney(tr.total)}</span></div>
        <ul>${tr.items.map((it) => `<li>${esc(it.name)} <span>${esc(it.buy || `${it.packs} × ${it.unit}`)}, ${roundMoney(it.cost)}</span></li>`).join("")}</ul>
      </div>`).join("")}
  </section>`;
}

function screenUpkeep() {
  return `<section class="screen">
    ${back("#/home")}
    <h1 tabindex="-1">Keep it fresh</h1>
    <p class="lede">A kit only helps if it still works. Put in when you last checked each part and Ready tells you when it's due again.</p>
    ${UPKEEP.map((u) => {
      const s = upkeepStatus(u);
      return `<div class="upkeep-row">
        <div><h2>${u.label}</h2><p class="upkeep-note">${u.note}${sourceLink(u.src)}</p></div>
        <label><span class="sr-only">Last checked: ${u.label}</span><input type="date" data-upkeep="${u.id}" value="${state.upkeep[u.id] || ""}" max="${todayISO()}"></label>
        <button type="button" class="btn btn-quiet" data-action="checked" data-checked="${u.id}">Checked today</button>
        <span class="pill ${s.cls}">${s.text}</span>
      </div>`;
    }).join("")}
  </section>`;
}

function screenTune() {
  const isBag = state.kit === "bag";
  const fa = alertThreats();
  return `<section class="screen">
    ${back("#/home")}
    <h1 tabindex="-1">Tune your kit</h1>
    <div class="group">
      <h2>Kit type</h2>
      <div class="seg" role="group" aria-label="Kit type">
        <button type="button" data-action="kit" data-kit="home" aria-pressed="${!isBag}">Home kit</button>
        <button type="button" data-action="kit" data-kit="bag" aria-pressed="${isBag}">Go-bag</button>
      </div>
      <p class="hint">${isBag ? "A go-bag is what you grab if you have to leave. It covers 3 days and leaves out heavy stuff." : "A home kit is for riding things out where you live. The Red Cross suggests 2 weeks."}</p>
    </div>
    <div class="group">
      <h2>Days to cover</h2>
      <div class="seg" role="group" aria-label="Days to cover">
        ${DAY_OPTIONS.map((d) => `<button type="button" data-action="days" data-days="${d}" ${isBag ? "disabled" : ""} aria-pressed="${isBag ? d === DEFAULT_DAYS : state.days === d}">${DAY_LABELS[d]}</button>`).join("")}
      </div>
    </div>
    <div class="group">
      <h2>What your area usually faces</h2>
      <p class="hint">Pick any that apply. Live alerts get added on top of these.</p>
      <div class="chips">${Object.entries(THREATS).map(([k, t]) => {
        const on = state.threats.includes(k) || !!fa[k];
        return `<button type="button" class="chip ${fa[k] ? "from-alert" : ""}" data-action="threat" data-threat="${k}" aria-pressed="${on}" ${fa[k] ? `title="Switched on by the ${esc(fa[k])}"` : ""}>${t.label}</button>`;
      }).join("")}</div>
    </div>
    <div class="group">
      <h2>Where you live</h2>
      <p class="hint" style="margin:0 0 8px">${state.location ? `Checking alerts for <strong>${esc(state.location.label)}</strong>.` : "Not set. Add it to get live weather alerts."}</p>
      <a href="#/setup/3">${state.location ? "Change place" : "Add place"}</a>
    </div>
  </section>`;
}

function screenAbout() {
  return `<section class="screen">
    ${back(state.setupDone ? "#/home" : "#/setup/1")}
    <h1 tabindex="-1">About and sources</h1>
    <p class="lede">Ready is a planning tool, not official guidance. In an emergency, follow instructions from local officials.</p>
    <p>Quantities follow <a href="${SOURCES.ready.url}" target="_blank" rel="noopener">Ready.gov</a> and <a href="${SOURCES.redcross.url}" target="_blank" rel="noopener">Red Cross</a> guidance where they give numbers: one gallon of water per person per day, a 7-day supply of prescriptions, and up to 2 weeks for a home kit. Some amounts (calories, food mix, diapers, batteries, hand warmers, electrolytes) and all prices are rough estimates. Prices you can edit.</p>
    <p>Weather alerts come from the <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a> and cover the US only. Place search uses <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noopener">Nominatim</a>, data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>.</p>
    <p>Your plan is saved on this device only. There are no accounts.</p>
  </section>`;
}

/* ---------- the router + redraw ---------- */

// Remember which button or box had focus, so keyboard users don't get thrown to the top.
function focusKey(el) {
  if (!el || !app.contains(el)) return null;
  if (el.id) return "#" + el.id;
  return Object.keys(el.dataset).length ? JSON.stringify(el.dataset) : null;
}
function findByKey(key) {
  if (!key) return null;
  if (key[0] === "#") return document.getElementById(key.slice(1));
  return [...app.querySelectorAll("[data-action],[data-have],[data-price],[data-upkeep]")].find((el) => JSON.stringify(el.dataset) === key) || null;
}

function render() {
  const r = route();
  if (!ROUTES.includes(r.name)) { go(state.setupDone ? "home" : "setup/1"); return; }
  if (!state.setupDone && r.name !== "setup" && r.name !== "about") { go("setup/1"); return; }

  const keep = focusKey(document.activeElement);
  const kit = computeKit();
  const body = {
    setup: () => screenSetup(r.n),
    home: () => screenHome(kit),
    list: () => screenList(kit),
    plan: () => screenPlan(kit),
    upkeep: () => screenUpkeep(),
    tune: () => screenTune(),
    about: () => screenAbout(),
  }[r.name]();

  app.innerHTML = (r.name === "setup" ? "" : alertBanner(r)) + body
    + `<footer class="foot"><a href="#/about">About and sources</a></footer>`;
  const f = findByKey(keep);
  if (f) {
    f.focus({ preventScroll: true });
    if (f.type === "text") f.setSelectionRange(f.value.length, f.value.length);
  }
  saveState();
}

window.addEventListener("hashchange", () => {
  locNote = null;
  render();
  window.scrollTo(0, 0);
  const h = app.querySelector("h1");
  if (h) h.focus({ preventScroll: true });
});

/* ================= 6. EVENTS ================= */

// Event delegation: ONE listener on #app catches every click, even on buttons
// that were drawn after the page loaded. Each button says what it does in data-action.

async function refreshAlerts() {
  if (!state.location) return;
  if (!navigator.onLine) { alertStatus = "offline"; render(); return; }
  alertStatus = "loading";
  render();
  try {
    const items = await fetchAlerts(state.location.lat, state.location.lon);
    state.alerts = { items, fetchedAt: new Date().toISOString() };
    alertStatus = "";
  } catch (e) {
    alertStatus = e.message === "outside-us" ? "outside" : navigator.onLine ? "error" : "offline";
    if (alertStatus === "outside") state.alerts = { items: [], fetchedAt: new Date().toISOString() };
  }
  render();
}

async function setLocation(loc) {
  state.location = loc;
  state.alerts = null;
  locNote = null;
  await refreshAlerts();
}

// Only runs when the person presses Find (Nominatim's rules: no search-as-you-type, 1 request per second).
async function findPlace() {
  const q = locDraft.trim();
  if (!q) { locNote = { msg: "Type a city or ZIP code first.", err: true }; render(); return; }
  if (Date.now() - lastSearch < SEARCH_GAP_MS) return;
  lastSearch = Date.now();
  locBusy = true;
  locNote = { msg: "Looking that up…" };
  render();
  try {
    const loc = await searchPlace(q);
    locDraft = "";
    locBusy = false;
    await setLocation(loc);
  } catch (err) {
    locBusy = false;
    locNote = { err: true, msg: err.message === "not-found"
      ? `Couldn't find "${esc(q)}" in the US. Try a ZIP code or "City, ST".`
      : "Couldn't search right now. Check your connection and try again." };
    render();
  }
}

function useGps() {
  if (!navigator.geolocation) { locNote = { msg: "This browser can't share your location. Type a city or ZIP instead.", err: true }; render(); return; }
  locNote = { msg: "Finding you…" };
  render();
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    const label = await nameForPoint(lat, lon);
    await setLocation({ lat, lon, label });
  }, () => { locNote = { msg: "Location is off for this site. Type a city or ZIP instead.", err: true }; render(); }, { timeout: 10000, maximumAge: 600000 });
}

function copyList(btn) {
  const kit = computeKit();
  const rows = kit.lines.filter((l) => !state.have[l.id]).map((l) => `- ${l.name}: ${(l.buy || `${l.packs} × ${l.unit}`)}${l.reminder ? "" : ` (${roundMoney(l.cost)})`}`);
  const text = `Ready kit shopping list\n${rows.join("\n")}\nTotal: ${roundMoney(kit.totals.cost)}`;
  const done = () => { btn.textContent = "Copied"; setTimeout(() => { if (btn.isConnected) btn.textContent = "Copy shopping list"; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => window.prompt("Copy this:", text));
  else window.prompt("Copy this:", text);
}

const ACTIONS = {
  step(b) {
    const group = state[b.dataset.group];
    group[b.dataset.key] = Math.max(0, Math.min(20, (group[b.dataset.key] || 0) + Number(b.dataset.step)));
    render();
  },
  kit(b) { state.kit = b.dataset.kit; render(); },
  days(b) { if (!b.disabled) { state.days = Number(b.dataset.days); render(); } },
  threat(b) {
    const k = b.dataset.threat;
    if (alertThreats()[k]) return; // switched on by a live alert, can't turn off
    state.threats = state.threats.includes(k) ? state.threats.filter((t) => t !== k) : [...state.threats, k];
    render();
  },
  cat(b) { state.openCats[b.dataset.cat] = !isOpen(b.dataset.cat); render(); },
  pay(b) { state.paychecks = Number(b.dataset.pay); render(); },
  checked(b) { state.upkeep[b.dataset.checked] = todayISO(); render(); },
  refresh() { refreshAlerts(); },
  geo() { useGps(); },
  copy(b) { copyList(b); },
  "reset-prices"() { state.prices = {}; render(); },
  finish() { state.setupDone = true; saveState(); go("home"); },
};

function bindEvents() {
  app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (b && ACTIONS[b.dataset.action]) ACTIONS[b.dataset.action](b);
  });

  app.addEventListener("input", (e) => { if (e.target.id === "locInput") locDraft = e.target.value; });

  app.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "locForm") findPlace();
  });

  app.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "showMath") state.showMath = t.checked;
    else if (t.id === "editPrices") state.editPrices = t.checked;
    else if (t.dataset.have) state.have[t.dataset.have] = t.checked;
    else if (t.dataset.price) {
      const v = parseFloat(t.value);
      if (!isNaN(v) && v >= 0) state.prices[t.dataset.price] = v;
    } else if (t.dataset.upkeep) state.upkeep[t.dataset.upkeep] = t.value;
    else return;
    render();
  });

  window.addEventListener("online", refreshAlerts);
}

/* ================= START ================= */
bindEvents();
render();
if (state.location && state.setupDone) refreshAlerts();
