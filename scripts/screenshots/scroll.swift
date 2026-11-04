import CoreGraphics

// Scrolls under the pointer: moves it to x,y, then one wheel step of `pixels`
// (negative scrolls down). usage: scroll x y pixels
let a = CommandLine.arguments
CGWarpMouseCursorPosition(CGPoint(x: Double(a[1])!, y: Double(a[2])!))
let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1,
                wheel1: Int32(a[3])!, wheel2: 0, wheel3: 0)!
e.post(tap: .cghidEventTap)
