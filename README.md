# Save3Clicks for Microsoft 365 Copilot

A configurable userscript that automatically selects your preferred model in Microsoft 365 Copilot and focuses the prompt field.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Userscript](https://img.shields.io/badge/type-userscript-blue.svg)](https://github.com/w6a8w8/m365-copilot-model-auto-selector)

> [!IMPORTANT]
> This is an independent, unofficial project. It is not developed, supported, or endorsed by Microsoft.

## Features

- Automatically selects a configured model when Microsoft 365 Copilot opens.
- Supports nested model menus through a configurable menu path.
- Separately configures the expanded menu path and collapsed selector label.
- Automatically focuses the chat prompt after model selection.
- Avoids stealing focus while you are editing another field.
- Handles client-side navigation between Copilot chats.
- Detects when Copilot returns to automatic mode and attempts selection again.
- Provides manual controls and diagnostics through the userscript-manager menu.
- Stores configuration locally through the userscript manager.
- Includes handling for dynamically rendered menus and Firefox interaction behaviour.

## Compatibility

| Component | Support |
|---|---|
| Microsoft 365 Copilot | `https://copilot.cloud.microsoft/*` |
| Violentmonkey | Recommended |
| Firefox | Supported by the script's focus and click handling |
| Chromium-based browsers | Expected to work with a compatible userscript manager |
| Other userscript managers | Not verified |

Microsoft can change the Copilot interface independently of this project. Model names, menu structures, and interface elements may differ by account, language, licence, or rollout group.

## Requirements

- Access to [Microsoft 365 Copilot](https://copilot.cloud.microsoft/)
- [Violentmonkey](https://violentmonkey.github.io/) or a compatible userscript manager
- Support for these userscript APIs:
  - `GM_getValue`
  - `GM_setValue`
  - `GM_registerMenuCommand`

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/).
2. Open `save3clicks.user.js` in this repository.
3. Select **Raw**.
4. Confirm the installation in Violentmonkey.
5. Open or reload [Microsoft 365 Copilot](https://copilot.cloud.microsoft/).

If the script file currently has a different name, use the file containing the `// ==UserScript==` metadata block. A `.user.js` suffix is recommended because userscript managers commonly recognize it as directly installable.

## Default configuration

Version 1.8.3 uses these defaults:

| Setting | Default |
|---|---|
| Expanded menu path | `GPT` → `GPT 5.6 Sol Hlubší přemýšlení` |
| Collapsed selector label | `GPT 5.6 Sol Think` |
| Automatic model selection | Enabled |
| Prompt auto-focus | Enabled |

The expanded menu path and collapsed selector label are configured separately because Copilot may show different text while the menu is open and after the model has been selected.

## Configuration

Open Microsoft 365 Copilot, select the Violentmonkey icon, and open the commands for **Save3Clicks for M365 Copilot**.

| Command | Purpose |
|---|---|
| **Configure model** | Sets the expanded menu path and collapsed selector label. |
| **Toggle automatic selection** | Enables or disables automatic model selection. |
| **Toggle prompt auto-focus** | Enables or disables automatic prompt focus. |
| **Select configured model now** | Runs model selection immediately. |
| **Focus prompt field now** | Attempts to focus the prompt immediately. |
| **Reset model configuration to default** | Restores the bundled defaults. |
| **Show current configuration** | Displays settings and detected interface state for troubleshooting. |

### Expanded menu path

Enter the menu levels in selection order and separate them with a vertical bar (`|`).

```text
GPT | GPT 5.6 Sol Hlubší přemýšlení
```

For a three-level menu:

```text
Provider | Model family | Model name
```

Use the labels displayed in your own Copilot interface.

### Collapsed selector label

Enter the label displayed by the closed model selector after you manually select the desired model.

```text
GPT 5.6 Sol Think
```

The script uses this value to determine whether the desired model is already active and to verify a completed selection.

## How it works

1. The script waits for a visible Copilot model-selector button.
2. It compares the current selector text with the configured collapsed label.
3. If the desired model is not active, it opens the model menu.
4. It follows the configured menu path one level at a time.
5. It selects the final item and checks the resulting selector label.
6. It locates the most likely chat prompt and focuses it.
7. It watches client-side navigation and relevant selector changes so that it can run again when needed.

Menu matching uses accessible names and rendered text. It normalizes case, whitespace, and punctuation, so forms such as `GPT-5.6` and `GPT 5.6` can be treated as equivalent.

The prompt detector scores visible editable elements and rejects common search fields. Automatic focus is skipped when another editable field is already active.

## Privacy and permissions

The script requests only these userscript permissions:

```text
GM_getValue
GM_setValue
GM_registerMenuCommand
```

It stores the following settings through the userscript manager:

- model menu path;
- collapsed selector label;
- automatic-selection preference;
- prompt-auto-focus preference.

The script does not declare `GM_xmlhttpRequest`, `@connect`, or another userscript network-request permission. Its metadata limits execution to:

```text
https://copilot.cloud.microsoft/*
```

Microsoft 365 Copilot and your userscript manager remain subject to their own permissions, privacy policies, and terms.

## Troubleshooting

### The model is not selected

1. Select the desired model manually.
2. Record every visible level of the expanded menu.
3. Record the label shown by the closed selector afterward.
4. Update both values using **Configure model**.
5. Run **Select configured model now**.
6. Run **Show current configuration** and check:
   - configured model path;
   - expected collapsed selector;
   - current selector text;
   - configured-model-active status.
7. Open the browser developer console and filter for:

```text
[Save3Clicks]
```

### The prompt is not focused

- Confirm that **Prompt auto-focus** is enabled.
- Run **Focus prompt field now**.
- Use **Show current configuration** to check whether a prompt field was found.
- Check whether another input, textarea, or editable element already has focus. The script deliberately avoids interrupting active editing.

### The script stopped working after a Copilot update

First verify the configured menu path and collapsed selector label. Microsoft may change visible labels, accessibility attributes, menu nesting, or rendering behaviour. If the labels are correct but selection still fails, collect the diagnostic information below and open an issue.

### Firefox-specific problem

Include these details in the report:

- Firefox version;
- Violentmonkey version;
- Save3Clicks version;
- configured expanded menu path;
- configured collapsed selector label;
- relevant console messages beginning with `[Save3Clicks]`;
- exact reproduction steps.

Remove account names, prompts, conversation content, tenant information, and other private data before posting.

## Reporting an issue

Use [GitHub Issues](https://github.com/w6a8w8/m365-copilot-model-auto-selector/issues).

Before opening an issue:

1. install the latest available version;
2. reload Copilot and reproduce the problem;
3. run **Show current configuration**;
4. inspect the developer console for `[Save3Clicks]` messages;
5. check whether the same issue has already been reported.

Include:

- browser and exact version;
- userscript manager and exact version;
- Save3Clicks version;
- configured model path and selector label;
- expected behaviour;
- actual behaviour;
- repeatable steps;
- sanitized console output.

## Development

Save3Clicks is plain JavaScript and requires no build step or runtime dependencies.

Recommended repository structure:

```text
.
├── .github/
│   └── ISSUE_TEMPLATE/
├── LICENSE
├── README.md
└── save3clicks.user.js
```

For each change:

1. create a focused branch from `main`;
2. make one logically related change;
3. update the userscript `@version` value;
4. update the version shown by **Show current configuration**;
5. test a fresh Copilot page load;
6. test client-side navigation between chats;
7. test with the configured model already active;
8. test with another model or automatic mode active;
9. test with automatic selection disabled;
10. verify that prompt focus does not interrupt another active editor;
11. merge the tested branch into `main`.

### Versioning

The project follows [Semantic Versioning](https://semver.org/) where practical:

- **Patch**, for example `1.8.3` → `1.8.4`: compatible bug fix
- **Minor**, for example `1.8.3` → `1.9.0`: backward-compatible feature
- **Major**, for example `1.8.3` → `2.0.0`: incompatible configuration or behaviour change

## Known limitations

- The script depends on a web interface controlled by Microsoft and may require updates after interface changes.
- Models and labels can vary between accounts, languages, licences, and rollout groups.
- Label-based configuration must be updated when Microsoft renames or restructures a model entry.
- Prompt detection uses heuristics because the page can contain multiple editable elements.
- Compatibility with userscript managers other than Violentmonkey has not been verified by this project.

## Contributing

Bug reports and focused contributions are welcome.

For code contributions:

- keep each change limited to one problem or feature;
- explain why the change is needed;
- describe exactly how it was tested;
- avoid unrelated formatting changes;
- update documentation when behaviour or configuration changes;
- do not include private Copilot content in screenshots, logs, or test data.

## Security

Review userscript source code before installation and install it only from a source you trust.

Do not publish credentials, cookies, session data, private prompts, or confidential Microsoft 365 content in an issue. If GitHub private vulnerability reporting is enabled for this repository, use it for security-sensitive reports. Otherwise, request a private reporting channel without posting vulnerability details publicly.

## License

This project is licensed under the [MIT License](LICENSE).

## Disclaimer

This project automates interaction with a third-party web interface. Microsoft may change that interface at any time. Test each release in your own environment before relying on it.

Microsoft, Microsoft 365, and Copilot are trademarks of the Microsoft group of companies. Their use here identifies compatibility and does not imply affiliation or endorsement.
