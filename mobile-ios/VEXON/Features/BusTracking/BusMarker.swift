import MapLibre
import UIKit
import VEXONKit

/// The bus marker icon — a top-down BUS (front = up), never a car, generic
/// vehicle or location pin. Drawn from the same 40×40 geometry as the web map's
/// busMarker.js and Android's BusIcon.kt so every platform shows the identical
/// bus. Body colour = tracking state.
@MainActor
enum BusIconRenderer {
    private static var cache: [String: UIImage] = [:]

    static func image(state: TrackingState, size: CGFloat = 40) -> UIImage {
        let key = "\(state.rawValue)-\(size)"
        if let hit = cache[key] { return hit }
        let body: UIColor = switch state {
        case .live: Theme.busLive
        case .stale: Theme.busStale
        case .offline: Theme.busOffline
        }
        let window = UIColor(red: 0xDB / 255, green: 0xEA / 255, blue: 0xFE / 255, alpha: 1)
        let tyre = UIColor(red: 0x1F / 255, green: 0x29 / 255, blue: 0x37 / 255, alpha: 1)
        let image = UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
            let c = ctx.cgContext
            let s = size / 40
            c.scaleBy(x: s, y: s)
            func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat, _ color: UIColor) {
                color.setFill()
                UIBezierPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r).fill()
            }
            // Wheels.
            for (x, y) in [(6.0, 7.0), (31.0, 7.0), (6.0, 27.0), (31.0, 27.0)] { rect(x, y, 3, 6, 1, tyre) }
            // Body with a white outline.
            rect(8, 2, 24, 36, 6, body)
            UIColor.white.setStroke()
            let outline = UIBezierPath(roundedRect: CGRect(x: 8, y: 2, width: 24, height: 36), cornerRadius: 6)
            outline.lineWidth = 2
            outline.stroke()
            // Windscreen (front).
            let ws = UIBezierPath()
            ws.move(to: CGPoint(x: 11, y: 6.5))
            ws.addQuadCurve(to: CGPoint(x: 29, y: 6.5), controlPoint: CGPoint(x: 20, y: 3))
            ws.addLine(to: CGPoint(x: 28, y: 11))
            ws.addLine(to: CGPoint(x: 12, y: 11))
            ws.close()
            window.setFill()
            ws.fill()
            tyre.setStroke()
            ws.lineWidth = 0.8
            ws.stroke()
            // Side windows.
            for y in [13.5, 19.5, 25.5] as [CGFloat] {
                rect(11, y, 3, 4, 0.8, window)
                rect(26, y, 3, 4, 0.8, window)
            }
            // Roof unit and rear bumper.
            rect(16, 16, 8, 10, 1.5, UIColor(white: 1, alpha: 0.35))
            rect(12, 33, 16, 2.5, 1, UIColor(white: 0, alpha: 0.25))
        }
        cache[key] = image
        return image
    }
}

/// A bus on the map. One instance per bus for the screen's lifetime; its
/// coordinate is moved (animated) as fixes arrive — no new markers per update.
final class BusAnnotation: MLNPointAnnotation {
    let busId: String
    var number: String
    var routeName: String?
    var tracking: TrackingState
    var heading: Double?

    init(bus: Bus) {
        busId = bus.id
        number = bus.number
        routeName = bus.routeName
        tracking = bus.tracking
        heading = BusMath.reliableHeading(bus.location?.heading, speed: bus.location?.speed)
        super.init()
        if let fix = bus.location { coordinate = CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lng) }
        title = bus.number
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

/// Labels ABOVE the icon: bus number, then route name, then the bus icon,
/// anchored so the icon's centre sits on the bus's coordinate.
final class BusMarkerView: MLNAnnotationView {
    static let reuseId = "bus"
    private let numberLabel = UILabel()
    private let routeLabel = UILabel()
    private let labelStack = UIStackView()
    private let icon = UIImageView()
    private let iconSize: CGFloat = 40

    override init(annotation: MLNAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        numberLabel.font = .systemFont(ofSize: 13, weight: .heavy)
        numberLabel.textColor = .white
        routeLabel.font = .systemFont(ofSize: 11, weight: .semibold)
        routeLabel.textColor = .white
        for label in [numberLabel, routeLabel] {
            label.textAlignment = .center
            label.adjustsFontForContentSizeCategory = false // fixed size keeps neighbouring markers readable
            label.lineBreakMode = .byTruncatingTail
        }
        labelStack.axis = .vertical
        labelStack.alignment = .center
        labelStack.spacing = 0
        labelStack.layoutMargins = UIEdgeInsets(top: 3, left: 8, bottom: 3, right: 8)
        labelStack.isLayoutMarginsRelativeArrangement = true
        labelStack.backgroundColor = UIColor(red: 0.07, green: 0.09, blue: 0.16, alpha: 0.88)
        labelStack.layer.cornerRadius = 8
        labelStack.addArrangedSubview(numberLabel)
        labelStack.addArrangedSubview(routeLabel)
        addSubview(labelStack)
        addSubview(icon)
        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(_ bus: BusAnnotation, selected: Bool, compact: Bool, mapDirection: Double) {
        numberLabel.text = bus.number
        routeLabel.text = bus.routeName
        // Zoomed out: number only, so nearby buses' labels overlap less.
        routeLabel.isHidden = compact || (bus.routeName ?? "").isEmpty
        icon.image = BusIconRenderer.image(state: bus.tracking, size: iconSize)
        labelStack.layer.borderWidth = selected ? 2 : 0
        labelStack.layer.borderColor = UIColor.systemYellow.cgColor
        layer.zPosition = selected ? 1000 : (bus.tracking == .live ? 10 : 1)
        accessibilityLabel = ["Bus \(bus.number)", bus.routeName, bus.tracking.label].compactMap { $0 }.joined(separator: ", ")

        let labelSize = labelStack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
        let width = max(iconSize, min(labelSize.width, 160))
        let height = labelSize.height + 2 + iconSize
        frame = CGRect(x: 0, y: 0, width: width, height: height)
        labelStack.frame = CGRect(x: (width - min(labelSize.width, 160)) / 2, y: 0, width: min(labelSize.width, 160), height: labelSize.height)
        icon.frame = CGRect(x: (width - iconSize) / 2, y: labelSize.height + 2, width: iconSize, height: iconSize)
        // centerOffset moves the view; shift it up so the icon centre (not the view centre) is on the point.
        centerOffset = CGVector(dx: 0, dy: height / 2 - (labelSize.height + 2 + iconSize / 2))
        rotateIcon(heading: bus.heading, mapDirection: mapDirection)
    }

    /// Rotate only the icon, and only when the heading is reliable (moving ≥ 2 m/s).
    func rotateIcon(heading: Double?, mapDirection: Double) {
        guard let heading else {
            icon.transform = .identity
            return
        }
        let degrees = heading - mapDirection
        icon.transform = CGAffineTransform(rotationAngle: CGFloat(degrees * .pi / 180))
    }
}

/// A route stop. Numbered dot; the selected stop is larger and highlighted.
final class StopAnnotation: MLNPointAnnotation {
    let stopId: String
    let sequence: Int
    init(stop: BusStop) {
        stopId = stop.id
        sequence = stop.sequence
        super.init()
        coordinate = CLLocationCoordinate2D(latitude: stop.lat, longitude: stop.lng)
        title = stop.name
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

final class StopMarkerView: MLNAnnotationView {
    static let reuseId = "stop"
    private let label = UILabel()

    override init(annotation: MLNAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        label.textAlignment = .center
        label.font = .systemFont(ofSize: 10, weight: .bold)
        label.textColor = .white
        addSubview(label)
        layer.borderColor = UIColor.white.cgColor
        layer.borderWidth = 2
        isAccessibilityElement = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(_ stop: StopAnnotation, selected: Bool, passed: Bool) {
        let size: CGFloat = selected ? 28 : 20
        frame = CGRect(x: 0, y: 0, width: size, height: size)
        layer.cornerRadius = size / 2
        label.frame = bounds
        label.text = "\(stop.sequence)"
        backgroundColor = selected ? UIColor.systemOrange : (passed ? UIColor.systemGray : UIColor(red: 0.11, green: 0.44, blue: 0.92, alpha: 1))
        layer.zPosition = selected ? 500 : 0
        accessibilityLabel = "Stop \(stop.sequence), \(stop.title ?? "")\(selected ? ", selected" : "")\(passed ? ", passed" : "")"
    }
}

/// The STUDENT's own position: a blue dot with an accuracy halo — visually
/// distinct from bus markers and never confused with them.
final class StudentLocationAnnotation: MLNPointAnnotation {}

final class StudentDotView: MLNAnnotationView {
    static let reuseId = "me"
    private let halo = UIView()
    private let dot = UIView()

    override init(annotation: MLNAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 44, height: 44)
        halo.frame = bounds
        halo.layer.cornerRadius = 22
        halo.backgroundColor = UIColor.systemBlue.withAlphaComponent(0.18)
        dot.frame = CGRect(x: 14, y: 14, width: 16, height: 16)
        dot.layer.cornerRadius = 8
        dot.backgroundColor = .systemBlue
        dot.layer.borderColor = UIColor.white.cgColor
        dot.layer.borderWidth = 3
        addSubview(halo)
        addSubview(dot)
        isEnabled = false
        isAccessibilityElement = true
        accessibilityLabel = "Your location"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

/// Route line parts: travelled (faded) vs remaining (solid).
final class RoutePolyline: MLNPolyline {
    var travelled = false
}
