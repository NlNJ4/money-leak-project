# Personal Finance LINE Bot

A simple personal finance tracker that lets users record income and expenses by chatting naturally with a LINE Bot.

The first version focuses on **text-first expense tracking** rather than receipt OCR. Users can type messages such as:

```text
ได้เงิน 2000
กินข้าว 120
เติมน้ำมัน 800
ได้เงินค่าฟรีแลนซ์ 5000
```

The bot interprets the message, categorizes the transaction, saves it, and replies with a confirmation.

---

## 1. Product Idea

The core idea is to remove the friction of manually filling out expense forms.

Instead of opening an accounting app and entering:

- Transaction type
- Amount
- Category
- Description
- Date

The user simply chats with the bot.

Example:

```text
User:
กินข้าว 120

Bot:
✅ บันทึกแล้ว

🍜 อาหาร
120 บาท

วันนี้ใช้ไปแล้ว 480 บาท
```

Another example:

```text
User:
ได้เงิน 2000

Bot:
✅ บันทึกแล้ว

💰 รายรับ
2,000 บาท
```

The long-term goal is to create a **Personal Money Inbox** where users can send financial information through LINE and automatically build their financial timeline.

---

## 2. Problem

Most people already have access to expense-tracking apps, but many stop using them because entering transactions manually is annoying.

The hypothesis is:

> If recording money is as easy as sending a LINE message, users may be more likely to track their finances consistently.

The MVP should validate this behavior before adding more complicated features such as receipt scanning.

---

## 3. Target Users

Start with personal use first.

Potential future users include:

- People who want simple personal expense tracking
- Freelancers
- Online sellers
- Small business owners
- People with multiple income sources
- Users who do not want complicated accounting applications

---

## 4. MVP

The first version should stay intentionally small.

### Main capabilities

#### Add an expense

```text
กินข้าว 120
```

Expected result:

```json
{
  "type": "expense",
  "amount": 120,
  "category": "food",
  "description": "กินข้าว"
}
```

---

#### Add income

```text
ได้เงิน 2000
```

Expected result:

```json
{
  "type": "income",
  "amount": 2000,
  "category": "other_income",
  "description": "ได้เงิน"
}
```

---

#### More natural language

```text
เมื่อวานไปกินตี๋น้อยกับเพื่อนหมดไป 829
```

Expected result:

```json
{
  "type": "expense",
  "amount": 829,
  "category": "food",
  "description": "กินตี๋น้อยกับเพื่อน",
  "transaction_date": "previous_day"
}
```

The backend should resolve relative dates before saving.

---

#### Daily summary

```text
วันนี้
```

Example response:

```text
📅 วันนี้

เงินเข้า    ฿5,500
เงินออก     ฿1,820
──────────
สุทธิ      +฿3,680

รายจ่าย

🍜 อาหาร       ฿620
🚕 เดินทาง      ฿350
🛒 ซื้อของ      ฿850
```

---

#### Monthly summary

```text
เดือนนี้
```

Example:

```text
August 2026

Income    ฿82,000
Expense   ฿45,300
──────────────
Net       +฿36,700

Top expenses

🍜 Food        ฿12,400
🏠 Housing     ฿10,000
🛒 Shopping     ฿8,200
🚕 Transport    ฿4,800
```

---

## 5. Recommended Stack

### Frontend

- Next.js
- TypeScript
- Vercel

Use the frontend mainly for:

- Login
- Dashboard
- Transaction history
- Reports
- Account settings
- LINE account linking

---

### Backend / Database

- Supabase
- PostgreSQL
- Supabase Auth
- Row Level Security

For the MVP, a separate Go backend or `core-api` is not required yet.

Next.js server routes can handle the initial API logic.

A standalone backend can be introduced later if the ecosystem grows.

---

### Authentication

Use:

```text
Supabase Auth
└── Google OAuth
```

There is no need to move to Firebase just to get Google Login.

Supabase is preferred for this project because financial data naturally benefits from relational queries and SQL aggregation.

Examples include:

- Spending by category
- Monthly income vs expenses
- Average monthly spending
- Spending comparisons
- Financial reports

These queries fit PostgreSQL well.

---

### LINE

Use:

- LINE Official Account
- LINE Messaging API
- Webhook

Suggested endpoint:

```text
POST /api/line/webhook
```

The webhook should:

1. Verify the LINE signature
2. Identify the LINE user
3. Read the incoming message
4. Detect known commands
5. Send natural language to the AI parser when needed
6. Validate the returned data
7. Save the transaction
8. Reply to LINE

---

### AI

Use Gemini API for the MVP.

A Flash model is enough because the main task is structured extraction and classification rather than heavy reasoning.

AI responsibilities:

```text
Natural language
      ↓
Structured transaction
```

Example:

```text
กินข้าว 120
```

becomes:

```json
{
  "intent": "add_transaction",
  "type": "expense",
  "amount": 120,
  "category": "food",
  "description": "กินข้าว"
}
```

---

## 6. Do Not Couple the App Directly to Gemini

Create an abstraction such as:

```ts
parseTransaction(text)
```

Example architecture:

```text
LINE message
    │
    ▼
parseTransaction()
    │
    ▼
Gemini
```

This makes it easy to change providers later:

```text
parseTransaction()
    │
    ├── Gemini
    ├── OpenAI
    └── Other provider
```

The rest of the application should not need to know which AI provider is being used.

---

## 7. Categories

Do not allow the AI to invent arbitrary categories.

Otherwise the database may eventually contain variations such as:

```text
food
food_and_drinks
dining
restaurant
meal
```

Instead, define an enum or fixed category list.

Suggested initial categories:

### Expenses

```text
food
transport
shopping
housing
bills
health
entertainment
family
other
```

### Income

```text
salary
freelance
investment
refund
other_income
```

The list can evolve after real usage.

---

## 8. Suggested Database Model

### users

```text
id
email
name
created_at
updated_at
```

---

### user_identities

A user may have multiple identities.

For example:

```text
Google account
+
LINE account
```

Schema:

```text
id
user_id
provider
provider_user_id
created_at
```

Possible providers:

```text
google
line
```

Example:

```text
user_id: 123

provider: google
provider_user_id: Google OAuth user ID

provider: line
provider_user_id: Uxxxxxxxxxxxxxxxx
```

Both identities belong to the same internal user.

---

### categories

```text
id
slug
name
type
icon
created_at
```

Example:

```text
food
Food
expense
🍜
```

---

### transactions

```text
id
user_id
type
amount
currency
category_id
description
transaction_date
source
created_at
updated_at
```

Recommended values:

```text
type:
- income
- expense
- transfer

source:
- line
- web
- receipt
```

For the first MVP, `transfer` can be postponed if necessary.

---

## 9. Architecture

```text
                         ┌─────────────────────┐
                         │       Google        │
                         │       OAuth         │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │      Next.js        │
                         │      Vercel         │
                         │                     │
                         │  Web Dashboard      │
                         │  API Routes         │
                         └───────┬──────┬──────┘
                                 │      │
                                 │      │
                     ┌───────────┘      └───────────┐
                     ▼                              ▼
             ┌──────────────┐              ┌──────────────┐
             │   Supabase   │              │    Gemini    │
             │              │              │     API      │
             │ Auth         │              └──────────────┘
             │ PostgreSQL   │
             │ RLS          │
             └──────────────┘
                     ▲
                     │
                     │ transactions
                     │
             ┌───────┴────────┐
             │ LINE Webhook   │
             │ Next.js API    │
             └───────▲────────┘
                     │
                     │ webhook
                     │
                ┌────┴────┐
                │  LINE   │
                │   Bot   │
                └─────────┘
```

---

## 10. Message Processing Flow

Example input:

```text
เติมน้ำมัน 800
```

Flow:

```text
LINE
  │
  ▼
POST /api/line/webhook
  │
  ▼
Verify LINE signature
  │
  ▼
Resolve LINE identity
  │
  ▼
Check command
  │
  ├── "วันนี้" ──────→ Supabase query
  │
  ├── "เดือนนี้" ───→ Supabase query
  │
  └── Natural text
          │
          ▼
   parseTransaction()
          │
          ▼
       Gemini
          │
          ▼
{
  "intent": "add_transaction",
  "type": "expense",
  "amount": 800,
  "category": "transport",
  "description": "เติมน้ำมัน"
}
          │
          ▼
      Validation
          │
          ▼
       Supabase
          │
          ▼
      LINE Reply
```

---

## 11. Commands That Should Not Require AI

Do not send everything to Gemini.

Known commands should be handled directly.

Examples:

```text
วันนี้
เดือนนี้
ล่าสุด
```

Possible future commands:

```text
เมื่อวาน
อาทิตย์นี้
เดือนก่อน
รายรับเดือนนี้
รายจ่ายเดือนนี้
```

This reduces:

- Latency
- Cost
- AI errors

---

## 12. Validation

Never insert Gemini output directly into the database.

Always validate:

```text
type
amount
category
transaction_date
```

For example:

```text
type must be:
income | expense

amount must be:
number > 0

category must exist in:
approved category list
```

If confidence is low or the message is ambiguous, ask the user to confirm.

Example:

```text
ให้แม่ 2000
```

Possible interpretation:

```text
Expense
2,000 THB
Category: Family
```

Bot:

```text
จะบันทึกเป็น

👨‍👩‍👧 Family
รายจ่าย 2,000 บาท

ถูกต้องไหม?
```

---

## 13. Security

Important rules:

### Never expose

```text
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
```

to the browser.

Keep them server-side only.

---

### Use Supabase RLS

Users should only be able to access transactions belonging to their own `user_id`.

---

### Verify LINE webhooks

Every LINE webhook request should have its signature verified before processing.

---

## 14. Google + LINE Identity Linking

The web dashboard uses Google authentication.

LINE uses a LINE user ID.

They need to map to the same internal account.

Recommended model:

```text
Internal User
      │
      ├── Google Identity
      │
      └── LINE Identity
```

Possible linking flow:

```text
1. User logs into the website with Google
2. Dashboard shows "Connect LINE"
3. Generate a temporary linking code
4. User sends the code to the LINE Bot
5. Backend links the LINE user ID to the logged-in user
```

Example:

```text
Website:
Your linking code is:

MONEY-4821
```

User sends:

```text
MONEY-4821
```

to the LINE Bot.

Backend then links both identities.

---

## 15. Web Dashboard

The first dashboard does not need to be complicated.

Suggested widgets:

### Current month

```text
Income
Expense
Net
```

### Spending by category

```text
Food
Transport
Shopping
Bills
etc.
```

### Recent transactions

```text
29 Aug   Lunch       -120
29 Aug   Freelance  +5000
28 Aug   Fuel        -800
```

### Filters

```text
Today
This week
This month
Custom range
```

---

## 16. Why Supabase Instead of Firebase

Firebase is a good product, but Supabase fits this specific application better.

This project will likely need queries such as:

```sql
SELECT
  category_id,
  SUM(amount)
FROM transactions
WHERE
  user_id = ?
  AND type = 'expense'
  AND transaction_date >= ?
GROUP BY category_id;
```

Financial reporting naturally involves:

- Aggregation
- Grouping
- Date ranges
- Relationships
- Analytics

PostgreSQL handles these patterns naturally.

Firebase may become less convenient when reporting becomes more complex.

Therefore the current recommendation is:

```text
Supabase: preferred
Firebase: optional alternative
```

---

## 17. Why Text-First Instead of Receipt-First

The original idea also considered sending bank slips or receipts.

Example:

```text
Send slip image
→ OCR / Vision
→ Detect amount
→ Detect sender/receiver
→ Detect income/expense
→ Save
```

This is possible and can be added later.

However, it introduces additional complexity:

- OCR errors
- Different bank layouts
- Image processing
- Detecting whether the user is sender or receiver
- Duplicate slips
- Privacy concerns
- Incorrect amount detection

The MVP should validate the simpler behavior first:

```text
Type message
→ AI understands
→ Save transaction
```

If users consistently use the text version, receipt support becomes a useful second input method.

---

## 18. Future Receipt / Bank Slip Support

Later versions can allow users to send bank transfer slips.

Possible flow:

```text
User sends bank slip
        │
        ▼
LINE downloads image
        │
        ▼
Vision model
        │
        ├── amount
        ├── sender
        ├── receiver
        ├── bank
        ├── date
        └── reference
        │
        ▼
Determine transaction type
        │
        ├── income
        ├── expense
        └── own transfer
        │
        ▼
User confirmation
        │
        ▼
Transaction saved
```

Potential fields:

```text
sender_name
sender_account
receiver_name
receiver_account
bank
reference_id
```

The original slip image should ideally not be stored permanently unless needed.

---

## 19. Future Features

Do not build these before validating the MVP.

Possible future features:

### Transaction editing

```text
เมื่อกี้ไม่ใช่อาหาร เป็นค่ารถ
```

---

### Delete transaction

```text
ลบรายการเมื่อกี้
```

---

### Recurring expenses

```text
ค่า Netflix 419 ทุกเดือน
```

---

### Budget

```text
เดือนนี้ตั้งงบอาหาร 6000
```

---

### Alerts

```text
เตือนถ้าค่าอาหารเกิน 5000
```

---

### Smart insights

```text
เดือนนี้ใช้เงินมากกว่าเดือนก่อน 18%
```

---

### Receipt OCR

Send:

- Restaurant receipts
- Bank slips
- Invoices

---

### Multiple channels

The backend can eventually support:

```text
LINE
Telegram
Web
Mobile App
Discord
```

All channels should write into the same transaction service.

---

## 20. Possible Future Core API

There is no need to create a standalone backend for the first version.

Current:

```text
Next.js / Vercel
      │
      ├── LINE webhook
      ├── AI parsing
      └── Supabase
```

Later, if multiple products or clients exist, the system can evolve into:

```text
LINE
Web
Mobile
Telegram
   │
   ▼
core-api
   │
   ├── Transaction Service
   ├── User Service
   ├── AI Service
   └── Reporting Service
   │
   ▼
PostgreSQL / Supabase
```

This keeps the MVP simple without preventing future expansion.

---

## 21. Development Roadmap

### Phase 1 — Foundation

- [ ] Create Git repository
- [ ] Create Next.js + TypeScript project
- [ ] Deploy to Vercel
- [ ] Create Supabase project
- [ ] Configure environment variables
- [ ] Create initial database schema
- [ ] Enable RLS

---

### Phase 2 — Authentication

- [ ] Enable Supabase Auth
- [ ] Configure Google OAuth
- [ ] Build login page
- [ ] Build logout flow
- [ ] Create user profile
- [ ] Protect dashboard routes

---

### Phase 3 — Transactions

- [ ] Create categories table
- [ ] Create transactions table
- [ ] Create transaction validation schema
- [ ] Add manual transaction API
- [ ] Display transactions on dashboard

---

### Phase 4 — LINE

- [ ] Create LINE Official Account
- [ ] Create Messaging API channel
- [ ] Configure channel secret
- [ ] Configure channel access token
- [ ] Create `/api/line/webhook`
- [ ] Verify LINE signatures
- [ ] Receive text messages
- [ ] Send LINE replies

---

### Phase 5 — Gemini

- [ ] Create Gemini API key
- [ ] Implement AI provider interface
- [ ] Implement `parseTransaction(text)`
- [ ] Require structured JSON output
- [ ] Validate AI result
- [ ] Map AI categories to approved categories
- [ ] Save parsed transaction

---

### Phase 6 — LINE Commands

- [ ] `วันนี้`
- [ ] `เดือนนี้`
- [ ] `ล่าสุด`
- [ ] Daily totals
- [ ] Monthly totals
- [ ] Category summaries

---

### Phase 7 — Account Linking

- [ ] Create `user_identities`
- [ ] Generate LINE linking code
- [ ] Connect LINE identity to Google-authenticated user
- [ ] Prevent identity duplication

---

### Phase 8 — Dashboard

- [ ] Income total
- [ ] Expense total
- [ ] Net amount
- [ ] Category breakdown
- [ ] Recent transactions
- [ ] Date filters

---

### Phase 9 — Real Usage

Use the application personally for at least several days.

Track:

- Incorrect categories
- AI mistakes
- Messages that are difficult to interpret
- Commands that are missing
- Steps that feel annoying
- Features actually used
- Features never used

Improve based on real behavior rather than assumptions.

---

### Phase 10 — Receipt / Slip Support

Only after the text workflow is useful:

- [ ] Receive images through LINE
- [ ] Download LINE image content
- [ ] Add Gemini Vision parsing
- [ ] Extract bank slip data
- [ ] Detect income / expense
- [ ] Detect duplicates
- [ ] Ask for confirmation
- [ ] Add receipt source to transactions

---

## 22. Recommended Implementation Order

If starting today, focus on these five things first:

```text
1. Supabase schema
      ↓
2. Google Auth
      ↓
3. Next.js + Vercel
      ↓
4. LINE webhook
      ↓
5. Text → Gemini → Transaction
```

After these work:

```text
Dashboard
↓
Summaries
↓
LINE linking
↓
Editing
↓
Receipt / slip support
```

---

## 23. MVP Success Criteria

The MVP is successful if the following workflow feels natural enough to use every day:

```text
User:
กินข้าว 120

Bot:
✅ บันทึกอาหาร 120 บาทแล้ว
```

And later:

```text
User:
วันนี้

Bot:
รายรับ 2,000 บาท
รายจ่าย 720 บาท
สุทธิ +1,280 บาท
```

If this behavior becomes a habit, the idea is worth expanding.

If users still avoid recording expenses even when it takes one LINE message, adding more features will probably not solve the underlying problem.

---

## 24. Current Technical Decision

Current preferred stack:

```text
Frontend
└── Next.js + TypeScript

Hosting
└── Vercel

Database
└── Supabase PostgreSQL

Authentication
└── Supabase Auth + Google OAuth

Messaging
└── LINE Messaging API

AI
└── Gemini API / Flash model

Deployment
└── Vercel

Future image processing
└── Gemini Vision
```

---

## 25. Product Principle

Keep the product centered around one idea:

> Recording money should feel like sending a message, not doing accounting.

Start simple.

Make the text experience excellent first.

Then expand the same transaction system to receipts, bank slips, dashboards, analytics, budgets, and additional channels.
