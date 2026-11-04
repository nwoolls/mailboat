import CoreGraphics

// Lists the windows of apps whose name contains the argument:
// pid, window number, on-screen, size and position.
let needle = CommandLine.arguments.dropFirst().first?.lowercased() ?? ""
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list {
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  guard owner.lowercased().contains(needle) else { continue }
  let b = w[kCGWindowBounds as String] as! [String: Any]
  print(w[kCGWindowOwnerPID as String]!, "win", w[kCGWindowNumber as String]!,
        "onscreen", w[kCGWindowIsOnscreen as String] ?? false,
        "\(b["Width"]!)x\(b["Height"]!)@\(b["X"]!),\(b["Y"]!)")
}
