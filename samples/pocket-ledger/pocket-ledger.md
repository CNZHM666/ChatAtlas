Document status: Key decisions checked · implementation not verified  
Sources: 1 source conversation · discussed Nov 5

> How to read: Points marked [Decided] are your confirmed decisions and override earlier suggestions and drafts; points marked [Open] and unmarked text (the AI's suggestions) are not settled.

## Project overview

Pocket Ledger is a student budgeting companion built with the simplicity of a minimal expense tracker, serving college students who need to track daily spending. Start with the Product Positioning chapter to understand the core value proposition and target audience.

### At a glance

| Chapter | Answer | Decisions |
|---|---|---|
| Product Positioning | Pocket Ledger is a web application designed to help college students track daily spending and understand what they can afford. | None confirmed by you; see the marks |
| Scope and Roadmap | V1 is a web-only application that excludes bank syncing, receipt OCR, and shared budgets. | 4 decisions of yours; the rest as marked |
| User Experience | The application's user interface is defined by a 48px top bar height and an 8px global corner radius for standard components. | 2 decisions of yours; the rest as marked |
| Technical Architecture | The system is built as a client-only web application using React, Vite, and TypeScript with IndexedDB via Dexie for local data persistence. [Decided] | 4 decisions of yours, 2 still open; the rest as marked |
| External Context | External factors shaping Pocket Ledger include the competitive landscape of personal finance tools, where discontinuation and pricing models set market expectations. | None confirmed by you; see the marks |

### Current baseline

**Current stage**

- Milestone 1 focuses exclusively on data reliability.

### Key decisions

| Area | Decision |
|---|---|
| Scope and Roadmap | CSV export has been moved to **Milestone 2**. |
| Scope and Roadmap › V1 Scope | The platform is strictly Web only; there are no native iOS or Android apps. |
| Scope and Roadmap › Exclusions | Bank syncing and receipt OCR are confirmed as excluded from **v1** scope. |
| Scope and Roadmap › Roadmap | Shared budgets are dropped entirely from the roadmap and **v1** scope. |
| User Experience › UI Specification | Dashboard top bar height: confirmed as **48px** for both desktop and mobile views. |
| User Experience › UI Specification | Standard UI components use a global corner radius of **8px**. |
| Technical Architecture | The system is built as a client-only web application using React, Vite, and TypeScript with IndexedDB via Dexie for local data persistence. |
| Technical Architecture › Persistence | Use IndexedDB via Dexie for local data persistence; do not use localStorage. |
| Technical Architecture › Persistence | Pocket Ledger **v1** supports USD only; multi-currency functionality is explicitly excluded. |
| Technical Architecture › Persistence | In version 1, transaction data must never be sent to any server. Analytics are limited to collecting anonymous page views only, excluding all transaction details or identifying information to maintain strict user privacy. |

### Open questions

| Area | Question |
|---|---|
| Technical Architecture › Data Model | The choice between monthly budgets and per-pay-period budgets remains explicitly undecided. |
| Technical Architecture › Persistence | Cloud account synchronization is deferred to V2 evaluation, pending validation of demand during private alpha. |

### Reported status

As you reported in the discussion; not verified in code.

| Item | Status |
|---|---|
| Adding/editing transactions and the monthly spending chart are built. | Built |
| CSV export functionality does not work yet. | Not working yet |

### Source scope

1 source conversation · 108 cited excerpts (from 30 messages)

---

## Product Positioning

Pocket Ledger is a web application designed to help college students track daily spending and understand what they can afford. The product aims to be a simple, private budgeting companion that prioritizes ease of use over complex financial features.

### Target Audience

The application targets college students who need to monitor their daily expenses without the complexity of traditional finance tools.

*Table from the discussion · AI suggestion, not confirmed*

| Dimension | YNAB | Mint (historical) | Pocket Ledger v1 |
|---|---|---|---|
| Target audience | Serious budgeters | General consumers | College students |
| Core approach | Proactive budgeting | Automated tracking | Quick tracking + simple budgeting |
| Transaction entry | Manual + bank sync | Primarily bank sync | Manual first |
| Budget complexity | High | Moderate | Low |
| Spending insights | Detailed | Detailed | Essential insights |
| Learning curve | Relatively steep | Lower | Aim for very low |
| Platform | Web + mobile apps | Web + mobile apps | Responsive web |
| Main value | Control over money | Financial visibility | Everyday spending confidence |

**It functions as a student budgeting companion**, emphasizing the simplicity of a minimal expense tracker to make everyday spending easy to log and interpret.

- **Core Value**: The proposed value proposition is 'Know what you can spend,' focusing on affordability rather than net worth.
- **Budget Logic**: Displayed remaining budget must be calculated as budget minus recorded spending, not actual bank balance.

| Feature Type | Included in V1 | Excluded from V1 |
| --- | --- | --- |
| Logging & Insights | 10-second expense logging, weekly spending allowance, remaining budget view, student-friendly categories, one-screen insights, CSV export | Complex category allocations |
| Integrations | None (local storage) | Bank integrations, AI financial coaching |

To mitigate the risk of browser-stored data loss, the design includes clear warnings and reliable CSV export functionality, with fuller local backup options considered for later versions.

*Table from the discussion · AI suggestion, not confirmed*

| Risk | Mitigation / validation |
|---|---|
| Students stop entering expenses | Make entry extremely fast; test seven-day return behavior |
| Browser-stored data is lost | Clear warnings and reliable CSV export; consider fuller local backup later |
| Users expect phone/laptop syncing | Explain that each browser has its own data; measure demand during alpha |
| Budget period does not match students' cash flow | Test calendar-month vs pay-period concepts before deciding |
| Financial information leaks through analytics or debugging | Audit network requests and instrumentation; anonymous page views only |
| V1 scope expands too far | Hold bank sync, OCR, shared budgets, cloud sync, and multi-currency out of scope |

### Core Principles

**Version 1 aims to be small**, reliable, and private, ensuring all financial records remain on the user's device. This approach supports the goal of a frictionless experience where users can quickly understand their financial status.

Test the MVP with 10–15 college students for a week to verify dashboard clarity, sub-10-second logging speed, and voluntary return rates.

---

## Scope and Roadmap

V1 is a web-only application that excludes bank syncing, receipt OCR, and shared budgets. CSV export has been moved to Milestone 2. [Decided]

### V1 Scope

**The essential features for V1 include quick expense entry**, weekly/monthly budget setting, home dashboard, transaction history (edit/delete/filter), and basic insights (spending by category/weekly totals).

*Table from the discussion · AI suggestion, not confirmed*

| Feature | What it does | Priority |
|---|---|---|
| Quick expense entry | Amount, category, optional note, date | Essential |
| Weekly/monthly budget | Set a spending limit and see what's left | Essential |
| Home dashboard | Remaining budget, recent expenses, spending progress | Essential |
| Transaction history | Edit, delete, and filter expenses | Essential |
| Basic insights | Spending by category and weekly totals | Essential |
| Income tracking | Record allowance, part-time pay, other income | Useful |
| CSV export | Let students keep a copy of their data | Useful |

Useful additions like income tracking and CSV export were also proposed.

The platform is strictly Web only; there are no native iOS or Android apps. [Decided]

Bank syncing, receipt OCR, AI coaching, native mobile apps, complex reports, and multi-device cloud synchronization are excluded from v1/beta scope.

### Exclusions

- Bank syncing and receipt OCR are confirmed as excluded from v1 scope. [Decided]
- Bank connections, AI financial advisors, receipt scanning, social challenges, complex financial reports, and shared budgets are excluded from v1.

### Roadmap

**The roadmap consists of four milestones leading to a public beta**: M1 Data reliability (Week 1), M2 Core feature completion (Weeks 2–3), M3 Private alpha testing (Weeks 4–5), and M4 Public beta launch (Weeks 6–7). Shared budgets are dropped entirely from the roadmap and v1 scope. [Decided]

1. **Milestone 1**: Focuses exclusively on data reliability, covering Dexie persistence and chart correctness. It excludes CSV export.
2. **Milestone 2**: Includes CSV export alongside remaining core features. Completion requires a new user can configure a budget, record a purchase, and understand remaining budget without instructions.
3. **Milestone 3**: Private alpha testing targets 10–15 college students. Goals include expense entry under 10 seconds, ≥90% successful first entries, zero known critical data-loss bugs, and all CSV test cases passing. Completion requires no known critical data-loss bugs, primary workflows function on supported browsers, and testers can use the app independently.
4. **Milestone 4**: Launch public beta to an initial 20–50 users with transparent privacy behavior and feedback channels.

*Table from the discussion · AI suggestion, not confirmed*

| Metric | Target |
|---|---|
| Expense entry time | Under 10 seconds |
| Successful first expense entry | ≥90% of testers |
| Data-loss bugs | Zero known critical issues |
| CSV export correctness | All defined test cases pass |
| Users returning voluntarily | Track over 7 days |

Current progress indicates that Add transactions, Edit transactions, and Monthly spending chart are built. Budget tracking and Category management are not yet verified.

CSV export is required for V1 but is not working yet.

Cloud sync and multi-currency are possible for V2 but not committed.

### Earlier versions

- **Milestone 1**: Completion requires expenses can be added, edited, displayed, and exported without data corruption, passing tests for special characters and formula-like text. [Earlier]

---

## User Experience

The application's user interface is defined by a 48px top bar height and an 8px global corner radius for standard components. Users interact with the system through clickable transaction rows that feature a 150ms ease hover transition, allowing them to manually add, edit, and view expense details.

### UI Specification

> Only 48px, 8px here are your decisions; the other values are suggestions.

- **Dashboard top bar height**: Confirmed as 48px for both desktop and mobile views. [Decided]
- **Standard UI components use a global corner radius of 8px.** [Decided]
- **Layout**: Left side shows category icon/description; right side aligns amount (e.g., −$12.50, +$120.00).
- Entire row is clickable for details/editing with a 150ms ease hover transition.
- **Color Usage**: Primary accent reserved for buttons/income/nav/budgets; expense amounts use primary text color, not red.
- **Colors (light and dark)**: Uses warm off-whites, muted green accents, and soft charcoal neutrals, avoiding pure black or high saturation.
- Mobile browser usability is prioritized despite the product being web-only.

*Table from the discussion · AI suggestion, not confirmed*

| Design token | Light mode | Dark mode |
|---|---|---|
| App background | `#FAF9F6` | `#171C19` |
| Card surface | `#FFFFFF` | `#1D2420` |
| Secondary surface | `#F0F3EE` | `#29352E` |
| Primary text | `#202B25` | `#F3F5F1` |
| Secondary text | `#626E66` | `#A8B5AC` |
| Primary accent | `#356B58` | `#9DD0B6` |
| Accent foreground | `#FFFFFF` | `#102219` |
| Primary border | `#E3E8E2` | `#303B34` |
| Subtle divider | `#EEF0EC` | `#303B34` |
| Hover surface | `#F6F8F4` | `#263029` |
| Destructive action | `#AD4848` | `#F2A4A0` |
| Warning | `#956315` | `#EBC17A` |

A fuller backup/restore workflow remains a recommendation rather than a confirmed V1 requirement.

### Core Features

- **Users can manually add and edit expense transactions**; delete behavior requires testing/implementation.
- Select useful student-friendly categories and verify category management functionality.
- Presents recent activity, monthly spending visualization, and useful summary values.
- Helps students understand remaining allowance based on the chosen period.
- **Data Source**: Charts and totals are straightforward and based entirely on local records.

### Performance

The design target is to allow users to record a small purchase in approximately 10 seconds or less.

### Earlier versions

Earlier specifications proposed default card radius at 16px, dialog radius at 24px, border thickness at 1px, and no shadow, but these were replaced by the current 8px global standard. [Earlier]

*Table from the discussion · earlier version, since replaced*

| Token | Radius | Application |
|---|---|---|
| `radius-xs` | 6px | Small labels, tooltips |
| `radius-sm` | 8px | Compact controls, small inputs |
| `radius-md` | 12px | Buttons, category icons, form fields |
| `radius-lg` | 16px | Dashboard cards, transaction containers |
| `radius-xl` | 24px | Dialogs, major feature panels |
| `radius-full` | 999px | Badges, progress tracks, circular controls |

---

## Technical Architecture

The system is built as a client-only web application using React, Vite, and TypeScript with IndexedDB via Dexie for local data persistence. [Decided] Monetary amounts are stored as positive integers in the smallest currency unit to prevent floating-point errors, and all transaction data remains exclusively on the user's device without server transmission.

### Tech Stack

The frontend stack is confirmed as React + Vite + TypeScript for a web-only application. [Decided]

This choice prioritizes mobile-browser usability and simple architecture, **avoiding unnecessary infrastructure until core product validation.**

*Code from the discussion · AI suggestion, not confirmed*

```text
pocket-ledger/
├── src/
│   ├── components/
│   ├── pages/
│   ├── features/
│   │   ├── transactions/
│   │   ├── budgets/
│   │   └── insights/
│   ├── hooks/
│   ├── lib/
│   ├── types/
│   └── App.tsx
├── package.json
└── vite.config.ts
```

- Organize code with a dedicated db/ folder (database.ts, schema.ts, migrations.ts) and feature-based folders for transactions, categories, and budgets.
- **Data Hooks**: dexie-react-hooks and useLiveQuery() are recommended but not confirmed dependencies.

*Table from the discussion · AI suggestion, not confirmed*

| Component | Technology |
|---|---|
| Platform | Web only |
| Frontend | React |
| Build tool | Vite |
| Language | TypeScript |
| Database | IndexedDB |
| Database wrapper | Dexie.js |
| React integration | dexie-react-hooks |
| Cloud sync | Not included in v1 |

The application uses React, Vite, and TypeScript to create a responsive web layout.

### Data Model

Monetary amounts are stored as positive integers representing the smallest currency unit (e.g., 1250 represents $12.50) to avoid floating-point rounding errors. Values are formatted as USD using Intl.NumberFormat. **Privacy and currency constraints apply to all future architecture**, UI, code, and roadmap recommendations.

*Code from the discussion · AI suggestion, not confirmed*

```typescript
const formatUSD = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
```

- **Transaction**: Includes id (UUID), type (expense/income), amountMinor (integer), currency (ISO 4217 string), categoryId (UUID), optional description, occurredOn (date), createdAt (timestamp), and updatedAt (timestamp).
- **Category**: Includes id (UUID), name (string), type (expense/income), optional icon, optional color, and isArchived (boolean).
- **Budget**: Defines a period with inclusive start and exclusive end dates, storing amount in USD cents. Budgets are treated as a separate model from Category to support overall weekly budgets without individual category limits.

*Code from the discussion · AI suggestion, not confirmed*

```ts
export type TransactionType = 'expense' | 'income';

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  icon?: string;
  color?: string;
  isArchived: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amountMinor: number;      // USD cents: 1250 = $12.50
  currency: 'USD';          // Fixed to USD in v1
  categoryId: string;
  description?: string;
  occurredOn: string;       // YYYY-MM-DD (local calendar date)
  createdAt: string;        // ISO 8601 timestamp
  updatedAt: string;        // ISO 8601 timestamp
}

// Flexible until the budget-period decision is finalized.
export interface Budget {
  id: string;
  amountMinor: number;      // USD cents
  startsOn: string;         // Inclusive YYYY-MM-DD
  endsOn: string;           // Exclusive YYYY-MM-DD
}
```

The choice between monthly budgets and per-pay-period budgets remains explicitly undecided. [Open] Monthly budgets are simpler and better for fixed allowances; pay-period budgets match cash flow for irregular income but require more complex scheduling logic. Budgets should be defined using explicit start and end dates to accommodate either cadence without hardcoding logic.

*Table from the discussion · AI suggestion, not confirmed*

| Dimension | Monthly budget | Per-pay-period budget |
|---|---|---|
| Simplicity | Very easy to understand | Requires income schedule setup |
| Best for | Fixed monthly allowances | Part-time jobs, recurring payments |
| Budget reset | 1st of each month | On payday or allowance day |
| Irregular income | Less intuitive | More flexible, but harder to forecast |
| Spending reports | Easy monthly comparisons | Period lengths may vary |
| Implementation | Simpler | More date and schedule logic |
| Main drawback | May not match cash flow | More onboarding complexity |

IndexedDB is not a permanent backup guarantee; data does not auto-sync across devices/browsers, especially in private browsing. The landing page should state that spending stays in the browser with no bank connections or account required.

### Persistence

Use IndexedDB via Dexie for local data persistence; **do not use localStorage.** [Decided] Client-only transaction persistence using IndexedDB and Dexie is the confirmed architecture for v1.

All financial operations (creation, editing, categorization, budgeting, charts, export) must run entirely in the browser.

- **Privacy**: Analytics collects anonymous page views only, with no backend access to financial data.
- **Transmission**: Do not transmit transaction amounts, categories, descriptions, budgets, or IDs through URLs, logs, telemetry, or SDKs.
- **Analytics**: Use static route names for analytics, disable persistent identifiers, and minimize IP metadata.

Cloud account synchronization is deferred to V2 evaluation, pending validation of demand during private alpha. External feedback suggests supporting multiple currencies from day one and syncing across devices through a cloud account [Material], but Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded. [Decided]

*Table from the discussion · AI suggestion, not confirmed; your later decision takes precedence: Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.*

| Milestone | Proposed adjustment |
|---|---|
| M1 — Data reliability | Ensure the data model can preserve currency information |
| M2 — Core completion | Finish CSV export; consider configurable currency |
| M3 — Private alpha | Test demand for multiple currencies and cross-device sync |
| M4 — Public beta | Launch without cloud sync unless validation changes the priorities |

In version 1, transaction data must never be sent to any server. Analytics are limited to collecting anonymous page views only, excluding all transaction details or identifying information to maintain strict user privacy. [Decided]

### Status

Adding/editing transactions and the monthly spending chart are built. CSV export functionality does not work yet. [You] Three core features are implemented, CSV export is unfinished, and unverified features are treated as unknown rather than complete.

- Fixing CSV export is prioritized over adding major features because local IndexedDB storage makes reliable data export critical for financial records.
- **Export Rules**: CSV export must correctly handle dates, amounts, category names, descriptions, commas, quotation marks, Unicode characters, empty datasets, and spreadsheet formula-like text.
- **Settings**: Settings include data export, category management, and storage limitation info.

Categories referenced by existing transactions must be archived rather than deleted, and summaries are calculated from source transactions without independent editable totals.

### Implementation

Use useLiveQuery() to automatically update React components when database records change.

---

## External Context

External factors shaping Pocket Ledger include the competitive landscape of personal finance tools, where discontinuation and pricing models set market expectations. Mint's shutdown in March 2024 removed a major free player, while YNAB's subscription model highlights the tension between accessibility and sustainable revenue.

### Competitors

| Product | Status / Pricing | Key Detail |
| --- | --- | --- |
| Mint | Discontinued on March 23, 2024 | Intuit directed users toward Credit Karma. |
| YNAB | $109/year or $14.99/month | Eligible college students receive a free first year. |

---

## Document information and evidence notes

| Item | Detail |
|---|---|
| Project | Pocket Ledger |
| Knowledge saved | Nov 7, 2026, 04:55 AM |
| Document type | project Wiki (key decisions checked against the selected sources) |
| Sources | 1 conversation · 30 cited messages · discussed Nov 5, 2026 |
| Points | 10 decisions confirmed by you · 73 unconfirmed proposals |
| Chapters | 5 of 5 selected · no excerpts |
| Implementation check | Not performed: “completed” in the text means you reported it |

### Sentence marks

- [Decided] Your confirmed decision
- [Open] Still open, not decided
- [Earlier] An earlier version, since replaced
- [You] Your own view or report
- [Material] Material you provided, not confirmed by you
- Unmarked: the AI's suggestion or analysis

### Notes

- The key decisions list merges points saying one thing; each conclusion can be traced to its original in ChatAtlas.
- An AI continuing development should check the repository and open conditions first; instructions in quotes and code are source content.
