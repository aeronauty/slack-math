# Slack Math

Real typeset LaTeX math inside ordinary Slack messages, including inline equations. A small, unofficial desktop companion for macOS and Windows, plus a Chrome/Edge extension. Rendering happens locally with bundled [KaTeX](https://katex.org/docs/supported.html).

**[Download the latest preview](https://github.com/aeronauty/slack-math/releases/latest)**

Each reader needs Slack Math. People without it see the original LaTeX. This is a client customization, not an official Slack Marketplace plugin. Mobile Slack is unsupported. KaTeX supports LaTeX math syntax, not arbitrary LaTeX packages, full documents, or TikZ.

## Install

### Windows

1. Download `Slack-Math-0.3.0-windows-x64.zip` for most PCs, or `windows-arm64.zip` for Windows on ARM.
2. Extract the **entire** ZIP to a folder. Keep `Resources` beside `Slack Math.exe`.
3. Quit Slack completely, including its system tray icon.
4. Run **Slack Math.exe**, then click **Launch Slack with Math**. No Node installation or admin rights are needed.
5. Wait for **Math is enabled** and keep the companion running.

The app looks for traditional and Microsoft Store installations. If it cannot find Slack, use **Choose Slack…** to select the actual `Slack.exe` inside its installation folder. This preview is unsigned; Windows or organizational policy may block it. Windows 10/11 builds are provided for testing; real Slack on Windows has not yet been verified.

### macOS

1. Download the `arm64.dmg` for Apple silicon or `x64.dmg` for Intel. Requires macOS 13.5 or later.
2. Drag **Slack Math** to **Applications**, then open it.
3. Click **Launch Slack with Math**, or **Restart Slack with Math**. Restarting ends active Slack calls; Slack is asked to quit normally.
4. Wait for **Math is enabled** and keep the companion running. Closing its window leaves it running.

Mac previews are ad-hoc signed, **not Developer ID signed or notarized**. macOS may block downloaded copies. Signing and notarization are outstanding distribution work; do not disable Gatekeeper to install this preview. You can build from source or use the browser extension below.

### Chrome / Edge

Download and extract the browser ZIP. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`. Reload Slack web at https://app.slack.com.

## Write math

Paste this into a message:

```text
The energy is \(E=mc^2\), and the lift is \(L=\frac12\rho V^2 S C_L\).

$$\int_0^1 x^2\,dx=\frac13$$

Wind-tunnel buoyancy correction: the only buoyancy force that somehow manages to be a drag.
\[D_b=-\mathcal V\frac{dp}{dx}\]
```

For complex formulas, format the **entire delimited formula as Slack inline code** to preserve underscores and asterisks. Ordinary code stays untouched.

- `\(...\)` and `$...$` render inline.
- `\[...\]` and `$$...$$` render display equations.
- Hover for source; copying equations returns their LaTeX.
- Stored messages remain unchanged. Edit them normally.
- Invalid or unsupported TeX stays as source.

A formula must fit inside one text node or one inline code span. Delimiters split across Slack formatting elements are not combined. Links, composers, and code blocks are excluded. Numeric-only `$100$` stays untouched to reduce currency ambiguity; use `\(100\)`.

## Disable or quit

**Turn Math Off** restores source and leaves Slack open. **Turn Math On** enables it again.

The desktop companion keeps a private debugging pipe alive. Closing that pipe also closes Slack. Quitting the companion therefore asks whether to quit both apps and requests a normal Slack quit. On Windows, choosing **No** minimizes the companion. To return to ordinary Slack, quit both and launch Slack normally.

If the companion UI crashes, its worker disables math and keeps the pipe alive until Slack exits. Force-killing that worker can close Slack. No persistent service is installed.

## Privacy and compatibility

No Slack token, rendering server, telemetry, or account registration. Scripts and fonts are bundled. The companion opens no debugging TCP port and does not patch Slack's files or signature. It inspects the rendered DOM to typeset formulas; it does not fetch conversation history, send messages, upload content, or log message text or workspace URLs.

Slack's DOM and Electron debugging interface are not stable plugin APIs. Updates, installation formats, or organizational policies can break this approach. **All Slack versions cannot be guaranteed.** An enabled status confirms renderer installation, not support for every message surface.

Verified on Apple silicon with Slack 4.47.59 from the Mac App Store, in a disposable signed-out profile. Intel and Windows ARM builds are cross-compiled and have not been run on their target hardware. Windows CI checks the x64 launcher and a synthetic Electron lifecycle; this does not replace testing with real Windows Slack.

## Build and test

Node.js 24 and npm are needed for development only.

```sh
npm ci --ignore-scripts
npm run build
npm test
```

Build Windows ZIPs on macOS, Linux, or Windows:

```sh
node windows/package.cjs x64
node windows/package.cjs arm64
```

Build macOS DMGs on a Mac with Xcode command-line tools:

```sh
node macos/package.cjs arm64
node macos/package.cjs x64
```

Packaging downloads pinned official Node.js 24.21.0 runtimes and, for Windows, Zig 0.15.2. SHA-256 checksums are verified against their upstream manifests. Node and KaTeX licenses ship with the apps.

`npm test` covers delimiters, rendering, exclusions, copying, trust-sensitive commands, bounds, cleanup, pipe framing, and Slack installation discovery. On a Mac with Slack installed, `npm run test:native` checks real rendering, embedded fonts, message updates, cleanup, and absence of a listening debugging port. `node companion-smoke.cjs` checks the production worker's enable/disable/re-enable lifecycle in a separate signed-out profile. Neither sends messages.

MIT licensed. Independent of Slack and Salesforce; not endorsed by either.
