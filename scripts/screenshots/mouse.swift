import CoreGraphics

// Moves the pointer out of the way. usage: mouse x y
CGWarpMouseCursorPosition(CGPoint(x: Double(CommandLine.arguments[1])!, y: Double(CommandLine.arguments[2])!))
