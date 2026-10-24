#!/usr/bin/env swift
// Exports the supplied vector symbol. Typography is HTML in Inter, never rasterized.
import AppKit
import Foundation

let target = URL(fileURLWithPath: "apps/web-admin/public/icons", isDirectory: true)
let source = try String(contentsOfFile: "alora logo.svg", encoding: .utf8)
let matcher = try NSRegularExpression(pattern: "<path d=\"([^\"]+)\"")
let pathData = matcher.matches(in: source, range: NSRange(source.startIndex..., in: source)).map {
  String(source[Range($0.range(at: 1), in: source)!])
}
if pathData.isEmpty { fatalError("Source logo has no vector paths") }
let tokens = try NSRegularExpression(pattern: "[A-Za-z]|[-+]?(?:[0-9]*\\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?")
func parse(_ data: String) -> NSBezierPath {
  let parts = tokens.matches(in: data, range: NSRange(data.startIndex..., in: data)).map { String(data[Range($0.range, in: data)!]) }
  let path = NSBezierPath(); path.windingRule = .evenOdd
  var index = 0; var command = ""; var cursor = NSPoint.zero; var start = NSPoint.zero
  func number() -> CGFloat { defer { index += 1 }; return CGFloat(Double(parts[index])!) }
  while index < parts.count {
    if parts[index].first!.isLetter { command = parts[index]; index += 1 }
    switch command {
    case "M":
      cursor = NSPoint(x: number(), y: number()); start = cursor; path.move(to: cursor)
    case "c":
      let c1 = NSPoint(x: cursor.x + number(), y: cursor.y + number())
      let c2 = NSPoint(x: cursor.x + number(), y: cursor.y + number())
      let end = NSPoint(x: cursor.x + number(), y: cursor.y + number())
      path.curve(to: end, controlPoint1: c1, controlPoint2: c2); cursor = end
    case "Z", "z":
      path.close(); cursor = start; command = ""
    default: fatalError("Unsupported SVG command: \(command)")
    }
  }
  return path
}
let paths = pathData.map(parse)
let bounds = paths.reduce(NSRect.null) { $0.union($1.bounds) }
let centerX = bounds.midX; let centerY = bounds.midY
let pathMarkup = pathData.map { "    <path d=\"\($0)\"/>" }.joined(separator: "\n")
func svg(maskable: Bool) -> String {
  let scale = 192 / bounds.width
  return """
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="alora app icon">
    <rect width="512" height="512" rx="\(maskable ? 0 : 24)" fill="#88bd39"/>
    <g fill="#fff" fill-rule="evenodd" transform="translate(256 256) scale(\(scale)) translate(\(-centerX) \(-centerY))">
  \(pathMarkup)
    </g>
  </svg>
  """ + "\n"
}
try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
try source.write(to: target.appendingPathComponent("alora-symbol.svg"), atomically: true, encoding: .utf8)
for maskable in [false, true] {
  try svg(maskable: maskable).write(to: target.appendingPathComponent(maskable ? "app-icon-maskable.svg" : "app-icon.svg"), atomically: true, encoding: .utf8)
}
func render(size: Int, maskable: Bool, filename: String) throws {
  guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("Cannot create icon context") }
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context; context.shouldAntialias = true
  let coordinates = NSAffineTransform()
  coordinates.translateX(by: 0, yBy: CGFloat(size)); coordinates.scaleX(by: CGFloat(size)/512, yBy: -CGFloat(size)/512); coordinates.concat()
  NSColor(srgbRed: 136/255, green: 189/255, blue: 57/255, alpha: 1).setFill()
  NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 512, height: 512), xRadius: maskable ? 0 : 24, yRadius: maskable ? 0 : 24).fill()
  let symbol = NSAffineTransform()
  symbol.translateX(by: 256, yBy: 256)
  // Tiny favicons need an optical enlargement to retain the supplied symbol.
  symbol.scale(by: (size <= 32 ? 350 : 192) / bounds.width)
  symbol.translateX(by: -centerX, yBy: -centerY); symbol.concat()
  NSColor.white.setFill(); for path in paths { path.fill() }
  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Cannot encode PNG") }
  try png.write(to: target.appendingPathComponent(filename))
}
for (size, name) in [(16, "favicon-16.png"), (32, "favicon-32.png"), (180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")] {
  try render(size: size, maskable: false, filename: name)
}
try render(size: 512, maskable: true, filename: "maskable-512.png")
print("alora: extracted symbol, SVG and six PNG exports generated")
