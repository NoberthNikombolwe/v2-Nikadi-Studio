# Nikadi Studio — Product Requirements Document

**Version:** 1.0  
**Date:** 2026-11-16  
**Status:** Active Development

---

## 1. Product Overview

Nikadi Studio is an internal business tool for Tanzanian event companies to design, manage, and distribute personalised invitation cards. It covers the full lifecycle from lead capture through design, delivery (WhatsApp + SMS), door check-in, and post-event finance.

### 1.1 Problem Statement

Event companies in Tanzania manually design and print/send invitation cards per guest, which is:
- Time-consuming (each card is unique per guest name and type)
- Error-prone (wrong names, wrong card types)
- Hard to track (did the guest receive their card?)
- Siloed (leads, customers, design, delivery all use different tools)

### 1.2 Solution

A single web app where the team can:
1. Capture leads and qualify them into paying customers and events
2. Design a card template once; the tool renders it personalised per guest
3. Import the guest list from Excel/CSV
4. Distribute cards via WhatsApp or SMS with tracking
5. Run door check-in with QR codes
6. Track per-event finances (income vs. expenses)

---

## 2. Users & Roles

| Role | Key | What They Do |
|------|-----|-------------|
| Super Admin | `superuser` | Full access including all data deletion |
| Admin | `admin` | Day-to-day management, users, settings |
| Sales Officer | `sales_officer` | Leads, customers, events, SMS |
| Graphics Designer | `graphics_designer` | Card design, WhatsApp delivery |
| Help Desk | `help_desk` | Scanner, calls, SMS support |
| Tele Sales | `telesales` | Phone follow-ups, guest confirmation calls |
| Finance Officer | `finance_officer` | Transactions, event profit/loss |

Access is invite-only. The Super Admin role is the **only** role that can permanently delete data.

---

## 3. Core Features

### 3.1 CRM Pipeline

**Leads → Follow-ups → Customers → Events**

- Capture a lead: event date, type (harusi, birthday, graduation, etc.), venue, package price, region, contact details
- Log follow-up attempts: call, WhatsApp, SMS, meeting, other
- When confirmed, qualify to a Customer and auto-create an Event
- Dashboard shows leads due today, overdue follow-ups

### 3.2 Event Management

Each event has:
- Name/title, event type, status (active/completed/cancelled)
- Venue name, address, GPS/location
- Start and end date/time
- Customer link, package price, region
- Guest invitation link toggle (opt-in public microsite)
- Card footer settings (branding pill on every card)
- Cover/template image, card element layout (draggable)

### 3.3 Card Designer

- Background image upload (or use a saved template)
- Draggable elements: guest name, card type, event date, QR code, logo
- Font selection (Google Fonts + uploaded fonts)
- Per-element text size, colour, bold/italic
- Renders personalised per guest via HTML canvas → exported as JPEG

### 3.4 Contact/Guest Management

- Import from Excel (.xlsx) or CSV
- Columns: `Name`, `Card Type`, `Phone`, plus arbitrary extras as SMS placeholders
- Each guest gets a UUID (`event_cards.id`), 8-char public ID, and 4-char display code
- Call tracker: record each guest's answer (coming / not coming / busy / picked up / not called)

### 3.5 WhatsApp Distribution

- Send rendered card images via WhatsApp to each guest
- Per-contact send status: idle → sending → sent → delivered → read
- Delivery reports polled from provider
- Zip export for bulk delivery outside the tool

### 3.6 SMS Distribution

- Personalised SMS templates with `{name}`, `{cardType}`, `{phone}`, `{extraColumn}` placeholders
- Multiple SMS messages per event (each with its own recipient set)
- Scheduled SMS: pick a time; `pg_cron` + Edge Function sends at that time
- Guest invitation link appended automatically when the event has guest links enabled

### 3.7 Guest Invitation Microsite

- Each event gets an 8-char public ID; each guest gets an 8-char public ID
- URL: `#/g/<eventPublicId>/<guestPublicId>`
- Full-screen hero (image + countdown timer), guest's card + download, schedule (Ratiba), dress code, photo gallery, hosts/MC, RSVP form, Leaflet.js map with satellite toggle + Google directions
- OG meta tags for WhatsApp/social link previews
- All page content is editable by admin in EventPageModal (no login required to view)

### 3.8 Door Scanner

- Each guest card has a QR code
- Dedicated public scan page (`#/scan/<eventId>`) with a one-time code
- Real-time scan log across devices
- Entry rules per card type (max scans, max people)
- Shared view-only report page for clients (`#/view/<eventId>`)

### 3.9 Finance

- Finance accounts: bank, mobile money, cash
- Per-event transactions: income and expenses
- Event P&L: total income, total expenses, gross margin
- Export to Excel

### 3.10 Schedules

- Schedule SMS or WhatsApp messages for a future date/time
- `pg_cron` triggers an Edge Function (`run-schedules`) every minute
- Delivery tracking per run

### 3.11 Settings

- General: company name, default SMS sender ID, card footer branding
- WhatsApp templates
- SMS sender IDs
- Card type rules (card types → number of people each admits)
- Role permissions (which role sees/edits which module)

---

## 4. Non-Functional Requirements

### 4.1 Security
- All app data behind Supabase RLS; `anon` role gets zero direct table access
- Invite-only sign-in; Supabase rejects unrecognised emails via a trigger
- Provider secrets never reach the browser (injected by Edge Functions)
- SECURITY DEFINER RPCs expose only the minimum fields needed for public pages

### 4.2 Performance
- Heavy libraries (xlsx, jszip) loaded on demand
- Leaflet.js loaded from CDN only when map section is visible
- Supabase real-time for scanner and delivery reports

### 4.3 Availability
- Hosted on Heroku (auto-deploy from `main` via GitHub Actions CI)
- Static SPA with a dependency-free Node.js server (`server.js`)
- Supabase Postgres + Storage as the backing service

### 4.4 Localisation
- Primary market: Tanzania
- Swahili terms used in guest-facing pages (Mwaliko, Ratiba, Mahali pa Sherehe, etc.)
- Phone numbers normalised to +255 format
- Currency in TZS (Tanzanian Shilling)
- Date formatting: English locale but Swahili context (harusi, ndoa, etc.)

---

## 5. Out of Scope (v1)

- Multi-tenant isolation (all authenticated users share one organisation)
- Self-service customer-facing booking portal
- Video/animated card templates
- WhatsApp Business API direct integration (uses messaging-service.co.tz as intermediary)
- Native mobile app
