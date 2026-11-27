# M365 Copilot Auto Select

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.8.5-brightgreen.svg)](m365-copilot-auto-select.user.js)

A lightweight userscript that automatically selects your preferred model and focuses the prompt input in Microsoft 365 Copilot.

## Features

- **Automatic model selection:** Selects your chosen model on page load, in-app navigation, and **New chat** clicks.
- **Nested submenu support:** Handles both top-level modes (e.g., `Think deeper`) and multi-level menus using `|` separators.
- **Prompt auto-focus:** Places the cursor in the message box automatically without stealing focus from other active inputs.
- **Non-intrusive:** Aborts immediately if you start typing or interact with the model picker, and skips clicking when the target model is already active.
- **Low overhead:** Uses self-disconnecting DOM observers and defers execution in background tabs until visible.
- **Any UI language:** Defaults to English (`Think deeper`) and works in any Copilot interface language once configured with your local labels.

## Supported Sites

- `https://copilot.cloud.microsoft/*`
- `https://m365.cloud.microsoft/chat*`

## Installation

1. Install a userscript manager such as [Violentmonkey](https://violentmonkey.github.io/) (recommended) or [Tampermonkey](https://www.tampermonkey.net/).
2. [**Install M365 Copilot Auto Select**](https://raw.githubusercontent.com/w6a8w8/m365-copilot-model-auto-selector/main/m365-copilot-auto-select.user.js) (click the link and confirm installation in your extension).
3. Open Microsoft 365 Copilot—the script runs automatically and checks for updates via GitHub.

## Configuration

Click your userscript manager's toolbar icon on a Copilot tab to open the script menu:

| Menu Command | Description |
| --- | --- |
| **Configure model** | Set the model menu path and expected switcher label. |
| **Run now** | Manually trigger model selection and prompt focus. |
| **Auto-select model** | Toggle automatic model switching (`ON` / `OFF`). |
| **Auto-focus prompt** | Toggle automatic cursor focus in the prompt box (`ON` / `OFF`). |
| **Reset to defaults** | Restore default settings (`Think deeper`, auto-select & auto-focus enabled). |
| **Debug logging** | Toggle diagnostic messages in the browser DevTools console. |

### Setting a Custom or Localized Model

When selecting **Configure model**, provide two values matching your Copilot UI language:

1. **Model menu path:** Enter the menu label as shown in Copilot. Separate submenu levels with `|`.
   - Single-level example: `Think deeper`
   - Nested submenu example: `GPT | GPT 5.6 Think deeper`
2. **Collapsed switcher label:** Enter the text displayed on the switcher button once that model is active (e.g., `Think deeper` or `GPT 5.6 Think`).

## Troubleshooting

- **Model isn't switching:** Open **Configure model** and verify the labels match your Copilot UI language and exact menu wording.
- **Need more details:** Enable **Debug logging** from the userscript menu, reload Copilot, and check `[M365 Copilot Auto Select]` logs in the browser console (`F12`).
- **UI changed after a Microsoft update:** Please [open an issue](https://github.com/w6a8w8/m365-copilot-model-auto-selector/issues) with your Copilot URL, UI language, and console logs.

## License

Released under the [MIT License](LICENSE).
