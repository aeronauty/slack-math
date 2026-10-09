import AppKit
import Darwin

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    let status = NSTextField(labelWithString: "Ready")
    let detail = NSTextField(wrappingLabelWithString: "")
    let compatibility = NSTextField(labelWithString: "")
    let launch = NSButton(title: "Launch Slack with Math", target: nil, action: nil)
    let stop = NSButton(title: "Turn Math Off", target: nil, action: nil)
    var worker: Process?
    var workerInput: Pipe?
    var workerOutput: Pipe?
    var outputBuffer = Data()
    var isLaunching = false
    var hadError = false
    var pendingQuit = false
    var mathDisabled = false
    var idleTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let menu = NSMenu()
        let item = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Slack Math", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Slack Math", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        menu.addItem(item)
        let edit = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editMenu
        menu.addItem(edit)
        NSApp.mainMenu = menu

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 550, height: 540), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Slack Math"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 18
        root.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 32),
            root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -32),
            root.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 26)
        ])
        let brand = NSStackView()
        brand.spacing = 12
        let icon = NSImageView(image: NSImage(systemSymbolName: "sum", accessibilityDescription: "Slack Math")!)
        icon.contentTintColor = .systemIndigo
        icon.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 32, weight: .semibold)
        icon.widthAnchor.constraint(equalToConstant: 44).isActive = true
        brand.addArrangedSubview(icon)
        brand.addArrangedSubview(label("Slack Math", size: 15, weight: .semibold))
        root.addArrangedSubview(brand)
        root.addArrangedSubview(label("Math, right inside Slack.", size: 29, weight: .bold))
        let intro = label("Typeset equations in your conversations.\nEverything renders locally on your Mac.", size: 14)
        intro.textColor = .secondaryLabelColor
        root.addArrangedSubview(intro)

        let stateCard = NSStackView()
        stateCard.orientation = .vertical
        stateCard.alignment = .leading
        stateCard.spacing = 8
        status.font = .systemFont(ofSize: 16, weight: .semibold)
        detail.font = .systemFont(ofSize: 13)
        detail.textColor = .secondaryLabelColor
        detail.widthAnchor.constraint(equalToConstant: 450).isActive = true
        detail.heightAnchor.constraint(greaterThanOrEqualToConstant: 38).isActive = true
        stateCard.addArrangedSubview(status)
        stateCard.addArrangedSubview(detail)
        root.addArrangedSubview(stateCard)

        let actions = NSStackView()
        actions.spacing = 12
        launch.bezelStyle = .rounded
        launch.controlSize = .large
        launch.target = self
        launch.action = #selector(start)
        launch.keyEquivalent = "\r"
        launch.contentTintColor = .systemIndigo
        stop.bezelStyle = .rounded
        stop.target = self
        stop.action = #selector(stopMath)
        stop.isEnabled = false
        actions.addArrangedSubview(launch)
        actions.addArrangedSubview(stop)
        root.addArrangedSubview(actions)

        let divider = NSBox()
        divider.boxType = .separator
        divider.widthAnchor.constraint(equalToConstant: 486).isActive = true
        root.addArrangedSubview(divider)
        root.addArrangedSubview(label("Try it in a message", size: 14, weight: .semibold))
        let example = label("The energy is \\(E=mc^2\\).", size: 14)
        example.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        example.isSelectable = true
        root.addArrangedSubview(example)
        let hint = label("For complex formulas, format the entire \\(…\\) as inline code.\nOther readers need Slack Math too.", size: 12)
        hint.textColor = .secondaryLabelColor
        root.addArrangedSubview(hint)
        compatibility.font = .systemFont(ofSize: 11)
        compatibility.textColor = .tertiaryLabelColor
        root.addArrangedSubview(compatibility)
        updateIdle()
        idleTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self = self, self.worker == nil, !self.isLaunching else { return }
            self.updateIdle(preserveMessage: true)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        return field
    }
    func slackURL() -> URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.tinyspeck.slackmacgap") }
    func runningSlack() -> [NSRunningApplication] { NSRunningApplication.runningApplications(withBundleIdentifier: "com.tinyspeck.slackmacgap") }
    func updateIdle(preserveMessage: Bool = false) {
        let found = slackURL()
        let running = !runningSlack().isEmpty
        launch.title = running ? "Restart Slack with Math" : "Launch Slack with Math"
        launch.isEnabled = found != nil
        stop.isEnabled = false
        let version = found.flatMap { Bundle(url: $0)?.infoDictionary?["CFBundleShortVersionString"] as? String } ?? "not found"
        compatibility.stringValue = "Slack \(version)  ·  Private connection, no listening port  ·  Unofficial companion"
        if !preserveMessage {
            status.stringValue = found == nil ? "Install Slack to get started" : running ? "Slack is already open" : "Ready to launch"
            status.textColor = .labelColor
            detail.stringValue = found == nil ? "Install the Slack desktop app, then reopen Slack Math." : running ? "Restarting will interrupt active calls. Your messages stay in Slack." : "Launch Slack here to enable inline math. Keep Slack Math running."
        }
    }
    @objc func start() {
        if worker != nil && mathDisabled {
            mathDisabled = false
            launch.isEnabled = false
            stop.isEnabled = true
            workerInput?.fileHandleForWriting.write(Data("enable\n".utf8))
            return
        }
        guard worker == nil, !isLaunching, let slack = slackURL() else { return }
        hadError = false
        isLaunching = true
        launch.isEnabled = false
        let running = runningSlack()
        guard !running.isEmpty else { launchWorker(slack); return }
        status.stringValue = "Restarting Slack…"
        detail.stringValue = "Waiting for Slack to quit normally. No forced quit will be used."
        running.forEach { _ = $0.terminate() }
        let deadline = Date().addingTimeInterval(15)
        Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            if self.runningSlack().isEmpty { timer.invalidate(); self.launchWorker(slack) }
            else if Date() > deadline {
                timer.invalidate()
                self.isLaunching = false
                self.showError("Slack did not quit. Quit it normally, then try again.")
            }
        }
    }
    func launchWorker(_ slack: URL) {
        guard let resources = Bundle.main.resourceURL else { showError("Application resources are missing."); return }
        let task = Process()
        task.executableURL = resources.appendingPathComponent("node")
        task.arguments = [resources.appendingPathComponent("companion.cjs").path, slack.appendingPathComponent("Contents/MacOS/Slack").path]
        var environment = ProcessInfo.processInfo.environment
        for key in ["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "ELECTRON_RUN_AS_NODE"] { environment.removeValue(forKey: key) }
        task.environment = environment
        let output = Pipe(), input = Pipe()
        task.standardOutput = output
        task.standardInput = input
        task.standardError = FileHandle.nullDevice
        outputBuffer = Data()
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { self?.receive(data) }
        }
        task.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.workerOutput?.fileHandleForReading.readabilityHandler = nil
                self.worker = nil
                self.workerInput = nil
                self.workerOutput = nil
                self.isLaunching = false
                self.updateIdle(preserveMessage: true)
                if !self.hadError {
                    self.status.stringValue = "Math is off"
                    self.status.textColor = .secondaryLabelColor
                    self.detail.stringValue = "Launch Slack here again to enable math. Messages remain unchanged."
                }
                if self.pendingQuit { NSApp.reply(toApplicationShouldTerminate: true) }
            }
        }
        do {
            try task.run()
            worker = task
            mathDisabled = false
            workerInput = input
            workerOutput = output
            isLaunching = false
            status.stringValue = "Connecting to Slack…"
            status.textColor = .labelColor
            detail.stringValue = "Checking compatibility and waiting for a workspace to load."
            stop.isEnabled = true
        } catch {
            isLaunching = false
            showError("The bundled runtime could not start. Reinstall Slack Math and try again.")
        }
    }
    func receive(_ data: Data) {
        outputBuffer.append(data)
        while let end = outputBuffer.firstIndex(of: 10) {
            let line = outputBuffer.prefix(upTo: end)
            outputBuffer.removeSubrange(...end)
            guard let message = try? JSONSerialization.jsonObject(with: line) as? [String: String], let state = message["state"] else { continue }
            if state == "error" { showError(message["detail"] ?? "Slack Math could not connect."); continue }
            if hadError { continue }
            if state == "disabled" {
                mathDisabled = true
                launch.title = "Turn Math On"
                launch.isEnabled = true
                stop.isEnabled = false
                status.stringValue = "Math is off"
                status.textColor = .secondaryLabelColor
                detail.stringValue = message["detail"] ?? ""
                continue
            }
            status.stringValue = state == "enabled" ? "●  Math is enabled" : state == "waiting" ? "Waiting for a workspace" : state == "stopped" ? "Math is off" : "Connecting to Slack…"
            status.textColor = state == "enabled" ? .systemGreen : .labelColor
            detail.stringValue = message["detail"] ?? ""
        }
    }
    func showError(_ message: String) {
        hadError = true
        status.stringValue = "Could not enable math"
        status.textColor = .systemRed
        detail.stringValue = message
        if worker == nil { updateIdle(preserveMessage: true) }
    }
    @objc func stopMath() {
        guard worker != nil else { return }
        stop.isEnabled = false
        status.stringValue = "Turning math off…"
        detail.stringValue = "Restoring visible formulas to their original LaTeX source."
        workerInput?.fileHandleForWriting.write(Data("disable\n".utf8))
    }
    @objc func about() {
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Slack Math", .applicationVersion: "0.3.0", .credits: NSAttributedString(string: "Local LaTeX math for Slack.\nAn unofficial companion. Powered by KaTeX and Node.js.")])
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { window.orderOut(nil); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let task = worker, task.isRunning else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "Quit Slack Math and Slack?"
        alert.informativeText = "Slack uses a private connection to this companion. Quitting both apps will end active Slack calls. To keep Slack open without math, use Turn Math Off instead."
        alert.addButton(withTitle: "Keep Running")
        alert.addButton(withTitle: "Quit Both")
        guard alert.runModal() == .alertSecondButtonReturn else { return .terminateCancel }
        pendingQuit = true
        runningSlack().forEach { _ = $0.terminate() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self = self, self.pendingQuit, self.worker != nil else { return }
            self.pendingQuit = false
            self.showError("Slack did not quit. Quit it normally, then close Slack Math.")
            NSApp.reply(toApplicationShouldTerminate: false)
        }
        return .terminateLater
    }
}
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
