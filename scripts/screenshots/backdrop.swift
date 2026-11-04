import AppKit

// A borderless window that paints a picture (aspect fill) behind the app
// window, so its translucent parts show something nice instead of the
// desktop. usage: backdrop x y w h image   (top-left x,y in points, main display)
final class Fill: NSView {
  let img: NSImage
  init(frame: NSRect, img: NSImage) { self.img = img; super.init(frame: frame) }
  required init?(coder: NSCoder) { fatalError() }
  override func draw(_ r: NSRect) {
    let s = img.size, b = bounds
    let k = max(b.width / s.width, b.height / s.height)
    let w = s.width * k, h = s.height * k
    img.draw(in: NSRect(x: (b.width - w) / 2, y: (b.height - h) / 2, width: w, height: h),
             from: .zero, operation: .copy, fraction: 1)
  }
}
let a = CommandLine.arguments
let x = Double(a[1])!, y = Double(a[2])!, w = Double(a[3])!, h = Double(a[4])!
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
// The main display (screens[0]): where place.sh puts the demo window.
let screenH = NSScreen.screens[0].frame.height
let rect = NSRect(x: x, y: screenH - y - h, width: w, height: h)
let win = NSWindow(contentRect: rect, styleMask: .borderless, backing: .buffered, defer: false)
win.isOpaque = true
win.hasShadow = false
win.ignoresMouseEvents = true
win.level = .normal
guard let img = NSImage(contentsOfFile: a[5]) else { print("bad image"); exit(1) }
win.contentView = Fill(frame: NSRect(origin: .zero, size: rect.size), img: img)
win.orderFrontRegardless()
app.run()
