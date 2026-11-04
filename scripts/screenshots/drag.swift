import CoreGraphics
import Foundation

// A press-and-drag with the left button, like a hand: down at x1,y1, an eased
// move to x2,y2 (with a little wobble), up. With the same start and end it is
// a click. usage: drag x1 y1 x2 y2 [milliseconds]
let a = CommandLine.arguments
let x1 = Double(a[1])!, y1 = Double(a[2])!, x2 = Double(a[3])!, y2 = Double(a[4])!
let ms = a.count > 5 ? Int(a[5])! : 600
let steps = max(3, ms / 12)

func post(_ type: CGEventType, _ x: Double, _ y: Double) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y),
          mouseButton: .left)!.post(tap: .cghidEventTap)
}
post(.mouseMoved, x1, y1)
usleep(120_000)
post(.leftMouseDown, x1, y1)
for i in 1...steps {
  let t = Double(i) / Double(steps)
  let eased = t * t * (3 - 2 * t)
  let wobble = sin(t * 9) * 2.5 * sin(t * Double.pi)
  post(.leftMouseDragged, x1 + (x2 - x1) * eased, y1 + (y2 - y1) * eased + wobble)
  usleep(UInt32(ms * 1000 / steps))
}
post(.leftMouseUp, x2, y2)
