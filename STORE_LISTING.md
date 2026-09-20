# Chrome Web Store listing — paste-ready copy

Everything the developer dashboard asks for, in the order it asks. Fill the two
`TODO` items before submitting.

---

## Product details

**Name:** Vault Dweller

**Summary** (132 char limit — this is the manifest description, keep them identical):

> Query, explore and edit your Veeva Vault data model with VQL. Not affiliated with Veeva Systems Inc.

**Category:** Developer Tools
**Language:** English

**Detailed description:**

> Vault Dweller is a developer tool for Veeva Vault. Open it on any Vault tab and work with
> your data directly: write and run VQL, read results in a table, and edit values inline.
>
> WHAT IT DOES
>
> • Run VQL queries with autocomplete driven by your Vault's own object metadata
> • Browse objects, fields, types and document types, and count documents per type
> • Edit result values inline and save changes back to Vault
> • Export results to CSV or Excel
> • Ask questions about the Vault API, answered from Veeva's documentation and grounded in
>   your own Vault's configuration
>
> HOW IT AUTHENTICATES
>
> Vault Dweller uses the Vault session you are already signed in to. There is no separate
> login, and no credentials are collected.
>
> THE AI FEATURE IS OPTIONAL
>
> The Ask tab is off until you add your own API key for Anthropic, OpenAI or Google. Your
> key is stored locally on your device and is sent only to the provider you chose. Questions
> and a relevant slice of your Vault's configuration — object and field names, document type
> names — are sent to that provider so answers use your real API names. Your Vault records
> are never sent. Each answer shows you exactly what was included.
>
> PRIVACY
>
> No analytics, no telemetry, no tracking. Nothing is sent to the developer — the extension
> has no server. Full policy: TODO_PRIVACY_POLICY_URL
>
> Vault Dweller is an independent tool. It is not affiliated with, endorsed by, or sponsored
> by Veeva Systems Inc. "Veeva" and "Vault" are trademarks of their respective owners.

**Privacy policy URL:** TODO — host `PRIVACY.md` (GitHub Pages is fine) and paste the URL
**Support email:** kristof.domokos.szabo@gmail.com

---

## Graphics

| Asset | Spec | Notes |
|---|---|---|
| Store icon | 128×128 PNG | `icons/icon128.png` |
| Screenshots | 1280×800 PNG, 1–5 | See shot list below |
| Small promo tile | 440×280 PNG | Optional, improves placement |

**Shot list** — use a demo Vault or redact. Screenshots are public permanently.

1. Query tab with a result table (the core function, first impression)
2. Data model browser with an object expanded
3. Document types with counted documents
4. Ask tab with an answer, citations and the vault-context chip visible
5. The user panel showing AI provider setup

---

## Privacy practices tab

**Single purpose:**

> Vault Dweller is a developer tool for Veeva Vault. It runs VQL queries, browses the object
> and document-type metadata of the Vault the user is signed in to, and answers questions
> about that same Vault's API using documentation retrieval and the user's own AI provider
> key. Every feature serves one purpose: working with Veeva Vault data and its API.

**Permission justifications:**

| Field | Text to paste |
|---|---|
| `cookies` | Reads the Veeva Vault session cookie (TK) on the user's own \*.veevavault.com domain so API calls run as the already signed-in user. No cookie is read from any other domain, and no cookie is transmitted anywhere except back to that same Vault. |
| `activeTab` | Identifies which Vault tab the user is on when they click the toolbar icon, so the panel connects to the right Vault instance. |
| `storage` | Stores the user's Vault domain, query history, cached object metadata and their AI provider key locally on the device. |
| `scripting` | Injects the overlay content script into the Vault tab when the toolbar icon is clicked, if it is not already present. |
| Host: `https://*.veevavault.com/*` | The extension's core function: reading and writing the user's Vault data through the Vault REST API. |
| Host: AI provider domains | Sends the user's question to the AI provider they chose, authenticated with an API key they supply. Used only when the user configures a key. |
| Host: `https://docs.veevavault.dev/*` | Retrieves passages from Veeva's public developer documentation to ground answers. |

**Remote code:** No. The extension executes no remote code and loads no remote resources;
fonts are bundled.

**Data collected — declare these two, and nothing else:**

- **Website content** — Vault object/field names and document type labels
- **User activity** — the question typed and the VQL in the editor

Both: **transferred to a third party** (the AI provider the user configures), and only when
the user enables and uses the Ask feature.

Explanation box:

> Data is sent directly from the user's browser to the AI provider they chose, authenticated
> with their own API key. Nothing is sent to the developer — the extension has no backend.
> Vault record data is never transmitted; only configuration (object names, field names,
> document type names) relevant to the question. The extension displays what was included
> alongside each answer.

**Certifications:** tick all three — not selling data, not using it for unrelated purposes,
not using it for creditworthiness.

---

## Before you hit submit

- [ ] Privacy policy hosted, URL pasted in both places above
- [ ] Trader/non-trader declaration completed (EU DSA; "trader" publishes your contact details)
- [ ] $5 developer registration paid, contact email verified
- [ ] Package built with `build.ps1` and tested via Load unpacked — **including the overlay
      on a real Vault page**, which is the one thing the automated tests here cannot cover
- [ ] Screenshots contain no real Vault data
- [ ] A tagged copy of the submitted zip kept — there is no rollback in the store
