import CoreGraphics
import Foundation

// One left click at x,y on screen, as a mouse makes it: a move, a press and a
// release 80ms apart, both marked as the first click (click state 1). WebKit
// fires `click` only for events that carry a click count, which System
// Events' `click at` does not always give. usage: click x y
let a = CommandLine.arguments
let x = Double(a[1])!, y = Double(a[2])!
func post(_ type: CGEventType) {
  let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y),
                  mouseButton: .left)!
  e.setIntegerValueField(.mouseEventClickState, value: 1)
  e.post(tap: .cghidEventTap)
}
post(.mouseMoved)
usleep(100_000)
post(.leftMouseDown)
usleep(80_000)
post(.leftMouseUp)
