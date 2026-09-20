# Vault Dweller — Privacy Policy

**Last updated:** 20 September 2026
**Applies to:** the Vault Dweller Chrome extension, all versions from 1.0.0

Vault Dweller is a developer tool for Veeva Vault. It runs in your browser. **It has no
backend server, and no data of any kind is sent to the developer.**

Not affiliated with, endorsed by, or sponsored by Veeva Systems Inc.

---

## The short version

- Nothing is sent to us. There is no analytics, no telemetry, no tracking, no advertising.
- Your Vault data goes only to your own Vault, exactly as it would in the browser tab.
- If — and only if — you turn on the AI feature, your question and a small slice of your
  Vault's **configuration** go to the AI provider you chose, using your own API key.
  Your Vault **records** are never sent there.
- Everything the extension remembers is stored locally on your own device.

---

## What the extension stores on your device

All of this lives in Chrome's local extension storage, on your machine. None of it is
transmitted to us or to anyone else.

| Stored | Why |
|---|---|
| Your Vault domain | To reconnect to the same Vault next time |
| Query history | So you can re-run recent VQL |
| Cached object and document-type metadata | So the data model browser and autocomplete work without re-fetching |
| Your AI provider API key | To authenticate requests to the provider you chose |

The API key is held by the extension's background service worker and is **never exposed to
the extension's own interface pages**. It is sent only to the AI provider you selected, over
HTTPS.

You can delete all of it at any time: use **Remove** to delete the API key, **Clear** to
delete query history, or uninstall the extension, which removes everything Chrome has
stored for it.

## Your Vault session

To call the Vault API as you, the extension reads the Veeva Vault session cookie (`TK`) for
the Vault domain you are signed in to. This cookie is used only to authenticate requests to
that same Vault. It is never sent anywhere else, never stored by the extension, and no
cookie is read from any other site.

## Where data goes when you use the AI feature

The AI feature is off until you enter an API key. When you ask a question, the following
leaves your browser:

**To the AI provider you selected** (Anthropic, OpenAI, or Google, per your choice),
authenticated with your own API key:

- the question you typed;
- documentation passages retrieved for that question;
- a selection of your Vault's **configuration** relevant to the question: object API names,
  field API names and types, document type names and labels, document counts where you have
  counted them, and the VQL currently in the editor.

The extension shows you what was included with each answer, on the chip beside the answer's
citations.

**Vault record data is never sent to an AI provider.** Query results, document contents and
field values do not leave your browser.

**To `docs.veevavault.dev`** (Veeva's public documentation service): the question you typed,
in order to retrieve relevant documentation passages. No credentials are sent.

Your use of those services is governed by their own privacy policies and terms:

- Anthropic — https://www.anthropic.com/legal/privacy
- OpenAI — https://openai.com/policies/privacy-policy
- Google AI — https://policies.google.com/privacy

## What we do not do

- We do not sell or transfer your data to third parties for advertising or any other
  unrelated purpose.
- We do not use your data for creditworthiness or lending purposes.
- We do not use your data for any purpose unrelated to the extension's single function:
  working with Veeva Vault data and its API.
- We collect nothing ourselves, so there is nothing for us to share, retain, or breach.

## Children

The extension is a professional developer tool and is not directed at children.

## Changes

Material changes to this policy will be published here with an updated date, alongside the
extension release that introduces them.

## Contact

Questions about this policy: **kristof.domokos.szabo@gmail.com**
