// Fonts for the card's text (Name, Card Type, …) and its footer.
//
// Three kinds:
//   google   — loaded from Google Fonts with the app (GOOGLE_FONTS_URL), so they work everywhere
//   device   — not on Google Fonts and can't be bundled (Aptos, Ananda). They work on a computer
//              that has them installed, or everywhere once their font file is uploaded in
//              Settings → General → Card fonts (app_settings.card_fonts, the "fonts" bucket)
//   uploaded — any other font file uploaded there
// A card is drawn by the browser of whoever makes it, so a font missing on that computer
// would silently become a standard font: Design and the card makers warn about it.

export const DEFAULT_CARD_FONT = "Plus Jakarta Sans";

export const CARD_FONTS = [
  { label: "Plus Jakarta Sans", value: "Plus Jakarta Sans", source: "google" },
  { label: "Poppins",           value: "Poppins",           source: "google" },
  { label: "Montserrat",        value: "Montserrat",        source: "google" },
  { label: "Raleway",           value: "Raleway",           source: "google" },
  { label: "Open Sans",         value: "Open Sans",         source: "google" },
  { label: "Roboto",            value: "Roboto",            source: "google" },
  { label: "Playfair Display",  value: "Playfair Display",  source: "google" },
  { label: "Oswald",            value: "Oswald",            source: "google" },
  { label: "Lato",              value: "Lato",              source: "google" },
  { label: "Dancing Script",    value: "Dancing Script",    source: "google" },
  { label: "Ubuntu",            value: "Ubuntu",            source: "google" },
  { label: "Outfit",            value: "Outfit",            source: "google" },
  { label: "Aptos",             value: "Aptos",             source: "device" },
  { label: "Ananda",            value: "Ananda",            source: "device" },
];

// The Google Fonts stylesheet: the app's own fonts and every "google" card font
export const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800"
  + "&family=JetBrains+Mono:wght@400;500&family=Poppins:wght@400;500;600;700;800&family=Montserrat:wght@400;500;600;700;800"
  + "&family=Raleway:wght@400;500;600;700;800&family=Open+Sans:wght@400;500;600;700;800&family=Roboto:wght@400;500;700"
  + "&family=Playfair+Display:wght@400;500;600;700&family=Oswald:wght@400;500;600;700&family=Lato:wght@400;700"
  + "&family=Dancing+Script:wght@400;500;600;700&family=Ubuntu:wght@400;500;700&family=Outfit:wght@400;500;600;700;800&display=swap";

// The uploaded fonts in Settings (app_settings.card_fonts), cleaned: [{ family, url }]
export const uploadedFonts = (value) => (Array.isArray(value) ? value : [])
  .filter(f => f && typeof f.family === "string" && f.family.trim() && typeof f.url === "string" && /^https:\/\//.test(f.url))
  .map(f => ({ family: f.family.trim(), url: f.url }));

// Every font to offer: the list above, then uploaded fonts that aren't in it
export const cardFontOptions = (uploaded = []) => {
  const up = uploadedFonts(uploaded);
  const have = new Set(CARD_FONTS.map(f => f.value.toLowerCase()));
  return [
    ...CARD_FONTS.map(f => (up.some(u => u.family.toLowerCase() === f.value.toLowerCase()) ? { ...f, source: "uploaded" } : f)),
    ...up.filter(u => !have.has(u.family.toLowerCase())).map(u => ({ label: u.family, value: u.family, source: "uploaded" })),
  ];
};

// Fonts a card needs that may be missing on this computer: "device" fonts that weren't uploaded.
// `installed(family)` tells whether this computer has a font (see isFontOnDevice in App.jsx).
export const missingCardFonts = (families = [], uploaded = [], installed = () => true) => {
  const options = cardFontOptions(uploaded);
  return [...new Set(families.filter(Boolean))].filter(fam => {
    const opt = options.find(o => o.value.toLowerCase() === String(fam).toLowerCase());
    return opt && opt.source === "device" && !installed(opt.value);
  });
};

// Font files that can be uploaded, with the type to store them as
export const FONT_FILE_TYPES = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };
export const FONT_MAX_BYTES = 5 * 1024 * 1024;

// Checks the "upload a card font" form → { errors, ext }
export const validateFontUpload = ({ family = "", fileName = "", size = 0 } = {}, uploaded = []) => {
  const errors = {};
  const name = String(family).trim();
  const ext = (/\.([a-z0-9]+)$/i.exec(String(fileName)) || [])[1]?.toLowerCase() || "";
  if (!name) errors.family = "Give the font its name, e.g. Aptos";
  else if (!/^[\p{L}\p{N} '-]{1,40}$/u.test(name)) errors.family = "Use letters, numbers, spaces, - or ' (up to 40)";
  else if (uploadedFonts(uploaded).some(f => f.family.toLowerCase() === name.toLowerCase())) errors.family = "A font with this name is already uploaded — remove it first to replace it";
  if (!fileName) errors.file = "Choose the font file";
  else if (!FONT_FILE_TYPES[ext]) errors.file = "Use a .ttf, .otf, .woff or .woff2 file";
  else if (size > FONT_MAX_BYTES) errors.file = "The file is over 5 MB";
  return { errors, ext };
};

// Where an uploaded font is stored in the "fonts" bucket (a new name each time, never overwritten)
export const fontFilePath = (family, ext, now = Date.now()) =>
  `${String(family).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "font"}-${now}.${ext}`;

// The font name a file suggests: "Aptos-Regular.ttf" → "Aptos"
export const familyFromFileName = (fileName = "") =>
  String(fileName).replace(/\.[a-z0-9]+$/i, "").replace(/[-_ ]?(regular|bold|italic|light|medium|semibold|book|roman|webfont|variable|vf)$/i, "")
    .replace(/[_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
