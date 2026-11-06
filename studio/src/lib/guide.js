// The in-app Guide: how work flows through Nikadi Studio, step by step, and how the
// pieces connect. Pure data + helpers so the content can be unit-tested; the Guide tab
// in App.jsx renders it. `tab` is the app tab each step lives in; `icon` is an <Icon> name.

export const GUIDE_STAGES = [
  { id: "win",     label: "Win the customer",  tone: "info", blurb: "Turn an enquiry into a paying customer with an event." },
  { id: "prepare", label: "Prepare the event", tone: "warn", blurb: "Design the card and bring in the guest list." },
  { id: "deliver", label: "Deliver",           tone: "good", blurb: "Send personalised cards and messages to every guest." },
  { id: "track",   label: "Track & get paid",  tone: "bad",  blurb: "See what was delivered and what the event earned." },
];

export const GUIDE_STEPS = [
  { id: "lead", stage: "win", tab: "leads", icon: "target", title: "Capture the lead",
    what: "Record every enquiry: name, phone, event type and date, package price, region and venue.",
    why: "Nothing gets forgotten — open leads are sorted so the most urgent follow-up is on top.",
    tips: ["Type prices the way you say them: 1.2k = 1,200.", "The red number on Leads counts follow-ups due today or overdue."] },
  { id: "followup", stage: "win", tab: "leads", icon: "phone", title: "Follow up",
    what: "Log each call, WhatsApp, SMS or meeting with a note and the next follow-up date.",
    why: "The whole team sees the history and knows exactly when to call back.",
    tips: ["Quick dates: tomorrow, 3 days, 1 week, 2 weeks.", "Use the pencil to correct a follow-up."] },
  { id: "customer", stage: "win", tab: "customers", icon: "users", title: "Qualify into a customer",
    what: "Qualify the lead: it becomes a customer (matched by phone, so no duplicates) and can create the event straight away.",
    why: "One customer can have many events — their whole history stays in one place.",
    tips: ["Choose “Qualify & create event” to skip retyping the details."] },
  { id: "event", stage: "prepare", tab: "events", icon: "folder", title: "Set up the event",
    what: "The event holds everything: details, card design, guest list, messages, history and money.",
    why: "Every later step works on the event that is open — its name shows in the header.",
    tips: ["Overview (eye icon) shows the customer, lead, sending and profit of an event in one pop-up."] },
  { id: "design", stage: "prepare", tab: "design", icon: "palette", title: "Design the card",
    what: "Upload the card background, then drag the name, QR code, date and logo into place.",
    why: "Each guest gets their own card with their name and QR code filled in.",
    tips: ["Save as Template to reuse a design for another event.", "The layout is remembered per template."] },
  { id: "contacts", stage: "prepare", tab: "design", icon: "table", title: "Import guests",
    what: "Upload the Excel/CSV guest list (Name, Card Type, Phone, plus any extra columns), then Save Cards to DB.",
    why: "Extra columns become placeholders like {Table} you can use in messages.",
    tips: ["Phone numbers in any local format are cleaned up automatically."] },
  { id: "upload", stage: "deliver", tab: "whatsapp", icon: "cloud", title: "Upload cards",
    what: "Render and upload every guest's card so WhatsApp can deliver it.",
    why: "WhatsApp needs each card online before it can be sent.",
    tips: ["Uploaded cards are kept with the guest list; upload again after changing the design or clearing images in Settings."] },
  { id: "whatsapp", stage: "deliver", tab: "whatsapp", icon: "whatsapp", title: "Send on WhatsApp",
    what: "Send each guest their card, one by one or all at once.",
    why: "You always confirm first: already-sent guests and shared numbers are listed so nobody is messaged twice by accident.",
    tips: ["Choose “Send again to all” only when you really mean to resend."] },
  { id: "sms", stage: "deliver", tab: "sms", icon: "sms", title: "Send SMS",
    what: "Write one or more messages per event with placeholders like {name}, and send to the guests or an uploaded list.",
    why: "Reminders, directions and thank-yous reach guests without WhatsApp too.",
    tips: ["Drafts save automatically.", "Check the SMS balance before a big send."] },
  { id: "schedule", stage: "deliver", tab: "sms", icon: "clock", title: "Schedule reminders", optional: true,
    what: "Plan SMS or WhatsApp sends ahead: pick dates, or days of the week (e.g. Mon, Wed, Fri) for a number of sends or until a date.",
    why: "Reminders go out on time from the server, even when nobody has the app open.",
    tips: ["Times that have already passed are refused.", "Pause, edit or cancel a schedule any time; every send is listed with its result."] },
  { id: "calls", stage: "deliver", tab: "calls", icon: "phone", title: "Confirm by phone", optional: true,
    what: "Call each guest from the Calls tab and record Picked up / Busy, then Coming / Not coming, with a comment.",
    why: "You know how many people to expect before the day — the summary adds up people using the card types.",
    tips: ["Tap the phone icon to dial straight from your phone.", "Card types (Double = 2 people…) are set in Settings → Card types."] },
  { id: "checkin", stage: "track", tab: "scanner", icon: "scan", title: "Check guests in", optional: true,
    what: "Scan each card's QR code at the door (or search by name). Double and group cards ask how many are entering.",
    why: "Nobody gets in twice on one card, even with several doors scanning at once.",
    tips: ["Share the scan page (link + code) with door staff who don't have an account.", "A new code locks the old link out immediately."] },
  { id: "reports", stage: "track", tab: "reports", icon: "report", title: "Check delivery",
    what: "See which guests got their card and SMS, and download the Excel report.",
    why: "Share proof of delivery with the customer.",
    tips: [] },
  { id: "history", stage: "track", tab: "history", icon: "history", title: "Event history",
    what: "Every send, result, upload, change and payment is logged with who did it and when.",
    why: "Answers “did this guest get it?” and “who changed this?” in seconds.",
    tips: ["History can't be edited or deleted — it's a permanent record."] },
  { id: "finance", stage: "track", tab: "finance", icon: "wallet", title: "Record money",
    what: "Record each payment received and every expense, with who paid or was paid and through which account.",
    why: "Each event shows its profit and margin, so you know which events really pay.",
    tips: ["Add your bank / mobile-money accounts first (Accounts button)."] },
];

// How the main records connect (drawn as the “How things connect” map)
export const GUIDE_LINKS = [
  { from: "Lead",     to: "Follow-ups",   label: "has many" },
  { from: "Lead",     to: "Customer",     label: "qualifies into" },
  { from: "Customer", to: "Events",       label: "has many" },
  { from: "Event",    to: "Guests & cards", label: "has many" },
  { from: "Event",    to: "SMS messages", label: "has many" },
  { from: "Event",    to: "History",      label: "logs everything to" },
  { from: "Event",    to: "Transactions", label: "earns & spends via" },
  { from: "Account",  to: "Transactions", label: "moves money for" },
  { from: "Card type", to: "Guests & cards", label: "sets how many enter on" },
  { from: "Role",     to: "Users",        label: "decides what they see for" },
];

export const stepsOfStage = (stageId) => GUIDE_STEPS.filter(s => s.stage === stageId);

// Which steps the open event has completed. `facts` comes from App state:
// { hasEvent, hasCustomer, hasLead, hasDesign, guests, uploaded, waSent, smsSent, txns }
export const guideProgress = (facts = {}) => {
  const f = { guests: 0, uploaded: 0, waSent: 0, smsSent: 0, txns: 0, ...facts };
  const done = {
    lead:     !!f.hasLead,
    followup: !!f.hasLead,
    customer: !!f.hasCustomer,
    event:    !!f.hasEvent,
    design:   !!f.hasDesign,
    contacts: f.guests > 0,
    upload:   f.uploaded > 0,
    whatsapp: f.waSent > 0,
    sms:      f.smsSent > 0,
    reports:  f.waSent > 0 || f.smsSent > 0,
    history:  !!f.hasEvent,
    finance:  f.txns > 0,
  };
  // Optional steps (calls, door check-in) appear on the map but don't count toward progress
  const ids = GUIDE_STEPS.filter(s => !s.optional).map(s => s.id);
  const count = ids.filter(id => done[id]).length;
  const next = ids.find(id => !done[id]) || null;
  return { done, count, total: ids.length, pct: Math.round((count / ids.length) * 100), next };
};
