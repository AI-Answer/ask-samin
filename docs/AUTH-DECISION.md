# Authentication decision

Decision date: 2026-07-13

## Decision

Do not deploy `opencoredev/login-with-chatgpt` as production member authentication or inference transport without written OpenAI approval.

Use the official, stable split instead:

- ChatGPT-native member experience: remote MCP/ChatGPT App. ChatGPT owns sign-in and model use; this application returns grounded retrieval results.
- Standalone web experience: deterministic retrieval and verified source links only. It holds neither member ChatGPT credentials nor an owner-funded model key.

## Evidence reviewed

- Reference repository commit [`7b3deeb`](https://github.com/opencoredev/login-with-chatgpt/commit/7b3deeb6e6bd539d594947f258a2fc26cf8fe866), dated 2026-07-10 and published as package version `0.2.0`.
- The reference hardcodes the Codex CLI public client ID, `codex_cli_rs` originator, and private `https://chatgpt.com/backend-api/codex` transport in its [constants](https://github.com/opencoredev/login-with-chatgpt/blob/7b3deeb6e6bd539d594947f258a2fc26cf8fe866/packages/core/src/constants.ts#L11-L24), [device flow](https://github.com/opencoredev/login-with-chatgpt/blob/7b3deeb6e6bd539d594947f258a2fc26cf8fe866/packages/core/src/device.ts#L33-L132), and [transport](https://github.com/opencoredev/login-with-chatgpt/blob/7b3deeb6e6bd539d594947f258a2fc26cf8fe866/packages/core/src/codex-transport.ts#L141-L190).
- OpenAI's official Codex source tells users to continue only when they started login in Codex and to cancel when a website supplied the code: [device-code warning](https://github.com/openai/codex/blob/b36c0b11896b0708035b0778de5635b45e84fe0d/codex-rs/login/src/device_code_auth.rs#L149-L157).
- OpenAI documents ChatGPT sign-in for Codex clients, while general API calls use Platform credentials: [Codex authentication](https://developers.openai.com/codex/auth).
- ChatGPT subscriptions and API usage are separately managed and billed: [OpenAI Help Center](https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions-even-if-i-have-a-paid-chatgpt-account).
- The official supported path for bringing a retrieval app into ChatGPT is the Apps SDK/MCP architecture: [Apps SDK quickstart](https://developers.openai.com/apps-sdk/quickstart).

## Material risks avoided

- A public app would hold broad, refreshable member credentials without narrow scopes.
- Traffic identifies itself as first-party Codex while originating from a third-party website.
- The private backend and hardcoded client version can change without notice.
- Default memory sessions and rate limits are not distributed serverless primitives.
- Per-process token-refresh coordination can race across Vercel instances.
- The reference transport allows caller instructions to replace handler defaults, weakening the Samin grounding prompt.

Generic MIT-licensed ideas such as opaque HttpOnly cookies, origin checking, shared rate-limit interfaces, and streaming UI patterns remain reusable. The Codex client identity, device flow, private transport, and “Login with ChatGPT” branding are not used here.
