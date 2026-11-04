import AVFoundation
import AppKit

// One frame of a video (macOS's own wallpapers are videos), as a PNG.
// usage: frame video.mov out.png [seconds]
let a = CommandLine.arguments
let gen = AVAssetImageGenerator(asset: AVAsset(url: URL(fileURLWithPath: a[1])))
gen.appliesPreferredTrackTransform = true
let t = CMTime(seconds: a.count > 3 ? Double(a[3])! : 0, preferredTimescale: 600)
let cg = try gen.copyCGImage(at: t, actualTime: nil)
let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: a[2]))
