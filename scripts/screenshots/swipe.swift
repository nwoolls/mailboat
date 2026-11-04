import CoreGraphics
import Foundation

// A two-finger swipe, as a trackpad sends it: the pointer goes to x,y, then a
// run of horizontal scroll events (a begin, a middle, an end) that ease in and
// out. Negative dx swipes left. usage: swipe x y dx [milliseconds]
let a = CommandLine.arguments
let x = Double(a[1])!, y = Double(a[2])!, total = Double(a[3])!
let ms = a.count > 4 ? Int(a[4])! : 350
let steps = max(8, ms / 12)
CGWarpMouseCursorPosition(CGPoint(x: x, y: y))
usleep(120_000)
var sent = 0.0
for i in 1...steps {
  let t = Double(i) / Double(steps)
  let target = total * (t * t * (3 - 2 * t))
  let delta = Int32((target - sent).rounded())
  sent += Double(delta)
  let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
                  wheel1: 0, wheel2: delta, wheel3: 0)!
  e.setIntegerValueField(.scrollWheelEventScrollPhase, value: i == 1 ? 1 : (i == steps ? 4 : 2))
  e.post(tap: .cghidEventTap)
  usleep(UInt32(ms * 1000 / steps))
}
