import AppKit
let folder = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        let bounds = NSRect(x: 0, y: 0, width: pixels, height: pixels)
        let inset = CGFloat(pixels) * 0.08
        NSColor(calibratedRed: 0.28, green: 0.25, blue: 0.75, alpha: 1).setFill()
        NSBezierPath(roundedRect: bounds.insetBy(dx: inset, dy: inset), xRadius: CGFloat(pixels) * 0.19, yRadius: CGFloat(pixels) * 0.19).fill()
        let text = "∑" as NSString
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: CGFloat(pixels) * 0.62, weight: .medium), .foregroundColor: NSColor.white]
        let extent = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: (CGFloat(pixels) - extent.width) / 2, y: (CGFloat(pixels) - extent.height) / 2 + CGFloat(pixels) * 0.03), withAttributes: attributes)
        image.unlockFocus()
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
