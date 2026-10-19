import MapLibre
import SwiftUI
import VEXONKit

/// A one-off camera move requested by the UI. A new `id` triggers it once.
struct MapCommand: Equatable {
    enum Kind: Equatable {
        case bus(String)
        case me
        case fitBusAndMe(String)
        case fitAll
    }
    let id = UUID()
    let kind: Kind
}

/// MapLibre Native map with bus-only markers, the selected route and stops,
/// and the student's blue dot. All state comes from `BusTrackingModel`; this
/// view only renders it.
struct BusMapView: UIViewRepresentable {
    let styleURL: URL
    let buses: [Bus]
    let selectedBusId: String?
    let route: BusRoute?
    let progress: RouteProgress?
    let selectedStopId: String?
    let student: CLLocationCoordinate2D?
    let command: MapCommand?
    let onSelectBus: (String) -> Void
    let onSelectStop: (String) -> Void
    let onMapError: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: styleURL)
        map.delegate = context.coordinator
        map.logoView.isHidden = false
        map.attributionButton.isHidden = false // style attribution (© OpenStreetMap contributors …) stays visible
        map.compassView.compassVisibility = .adaptive
        map.showsUserLocation = false // the student's dot is our own one-shot annotation, not continuous tracking
        map.minimumZoomLevel = 3
        map.maximumZoomLevel = 19
        map.accessibilityLabel = "Bus map"
        context.coordinator.map = map
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.sync()
    }

    static func dismantleUIView(_ map: MLNMapView, coordinator: Coordinator) {
        coordinator.stop()
        map.delegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, MLNMapViewDelegate {
        var parent: BusMapView
        weak var map: MLNMapView?

        private var busAnnotations: [String: BusAnnotation] = [:]
        private var stopAnnotations: [String: StopAnnotation] = [:]
        private var routeLines: [RoutePolyline] = []
        private var routeKey: String?
        private var studentAnnotation: StudentLocationAnnotation?
        private var lastCommandId: UUID?
        private var styleLoaded = false
        private var didInitialFit = false
        private var compact = false

        private struct Glide {
            let from: CLLocationCoordinate2D
            let to: CLLocationCoordinate2D
            let start: CFTimeInterval
            let duration: CFTimeInterval
        }
        private var glides: [String: Glide] = [:]
        private var displayLink: CADisplayLink?

        init(parent: BusMapView) { self.parent = parent }

        func stop() {
            displayLink?.invalidate()
            displayLink = nil
            glides.removeAll()
        }

        // MARK: Sync model → map

        func sync() {
            guard let map, styleLoaded else { return }
            syncBuses(on: map)
            syncRoute(on: map)
            syncStudent(on: map)
            refreshViews(on: map)
            if !didInitialFit, !busAnnotations.isEmpty {
                didInitialFit = true
                fitAllBuses(on: map, animated: false)
            }
            if let command = parent.command, command.id != lastCommandId {
                lastCommandId = command.id
                perform(command.kind, on: map)
            }
        }

        private func syncBuses(on map: MLNMapView) {
            let visible = parent.buses.filter { $0.location.map { BusMath.LatLng(lat: $0.lat, lng: $0.lng).isValid } ?? false }
            let ids = Set(visible.map(\.id))
            // Remove buses no longer visible to this viewer.
            let gone = busAnnotations.keys.filter { !ids.contains($0) }
            if !gone.isEmpty {
                map.removeAnnotations(gone.compactMap { busAnnotations[$0] })
                gone.forEach { busAnnotations[$0] = nil; glides[$0] = nil }
            }
            for bus in visible {
                guard let fix = bus.location else { continue }
                let target = CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lng)
                if let annotation = busAnnotations[bus.id] {
                    annotation.number = bus.number
                    annotation.routeName = bus.routeName
                    annotation.tracking = bus.tracking
                    annotation.heading = BusMath.reliableHeading(fix.heading, speed: fix.speed)
                    let current = annotation.coordinate
                    if current.latitude != target.latitude || current.longitude != target.longitude {
                        glide(bus.id, from: current, to: target)
                    }
                } else {
                    let annotation = BusAnnotation(bus: bus)
                    busAnnotations[bus.id] = annotation
                    map.addAnnotation(annotation)
                }
            }
        }

        private func syncRoute(on map: MLNMapView) {
            let key = parent.route.map { "\($0.id)|\(parent.progress?.fraction ?? -1)" }
            guard key != routeKey else { return }
            let routeChanged = parent.route?.id != routeKey?.split(separator: "|").first.map(String.init)
            routeKey = key
            map.removeAnnotations(routeLines)
            routeLines.removeAll()
            if routeChanged {
                map.removeAnnotations(Array(stopAnnotations.values))
                stopAnnotations.removeAll()
            }
            guard let route = parent.route else { return }
            let path = route.path
            let parts = BusMath.split(path: path, fraction: parent.progress?.fraction)
            for (points, travelled) in [(parts.travelled, true), (parts.remaining, false)] where points.count >= 2 {
                var coords = points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) }
                let line = RoutePolyline(coordinates: &coords, count: UInt(coords.count))
                line.travelled = travelled
                routeLines.append(line)
            }
            map.addAnnotations(routeLines)
            if routeChanged {
                for stop in route.orderedStops {
                    let a = StopAnnotation(stop: stop)
                    stopAnnotations[stop.id] = a
                }
                map.addAnnotations(Array(stopAnnotations.values))
            }
        }

        private func syncStudent(on map: MLNMapView) {
            if let coordinate = parent.student {
                if let existing = studentAnnotation {
                    existing.coordinate = coordinate
                } else {
                    let a = StudentLocationAnnotation()
                    a.coordinate = coordinate
                    a.title = "Your location"
                    studentAnnotation = a
                    map.addAnnotation(a)
                }
            } else if let existing = studentAnnotation {
                map.removeAnnotation(existing)
                studentAnnotation = nil
            }
        }

        private func refreshViews(on map: MLNMapView) {
            for (id, annotation) in busAnnotations {
                (map.view(for: annotation) as? BusMarkerView)?
                    .configure(annotation, selected: id == parent.selectedBusId, compact: compact, mapDirection: map.direction)
            }
            let passed = Set(parent.progress?.passedSequences ?? [])
            for (id, annotation) in stopAnnotations {
                (map.view(for: annotation) as? StopMarkerView)?
                    .configure(annotation, selected: id == parent.selectedStopId, passed: passed.contains(annotation.sequence))
            }
        }

        // MARK: Smooth movement

        /// Ease the marker from where it is now to the new fix. One annotation per
        /// bus is moved; no markers are created per update.
        private func glide(_ id: String, from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) {
            let distance = BusMath.distance(.init(lat: from.latitude, lng: from.longitude), .init(lat: to.latitude, lng: to.longitude))
            // Large jumps (first fix after a gap) snap instead of sliding across the map.
            if distance > 2_000 || UIAccessibility.isReduceMotionEnabled {
                busAnnotations[id]?.coordinate = to
                glides[id] = nil
                return
            }
            glides[id] = Glide(from: from, to: to, start: CACurrentMediaTime(), duration: 1.5)
            if displayLink == nil {
                let link = CADisplayLink(target: self, selector: #selector(step))
                link.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 30)
                link.add(to: .main, forMode: .common)
                displayLink = link
            }
        }

        @objc private func step() {
            let now = CACurrentMediaTime()
            for (id, g) in glides {
                let t = min(1, (now - g.start) / g.duration)
                let p = BusMath.lerp(.init(lat: g.from.latitude, lng: g.from.longitude), .init(lat: g.to.latitude, lng: g.to.longitude), BusMath.easeOut(t))
                busAnnotations[id]?.coordinate = CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng)
                if t >= 1 { glides[id] = nil }
            }
            if glides.isEmpty {
                displayLink?.invalidate()
                displayLink = nil
            }
        }

        // MARK: Camera

        private func perform(_ kind: MapCommand.Kind, on map: MLNMapView) {
            switch kind {
            case .bus(let id):
                if let a = busAnnotations[id] {
                    map.setCenter(a.coordinate, zoomLevel: max(map.zoomLevel, 15), animated: true)
                }
            case .me:
                if let c = parent.student { map.setCenter(c, zoomLevel: max(map.zoomLevel, 15), animated: true) }
            case .fitBusAndMe(let id):
                var points: [BusMath.LatLng] = []
                if let a = busAnnotations[id] { points.append(.init(lat: a.coordinate.latitude, lng: a.coordinate.longitude)) }
                if let c = parent.student { points.append(.init(lat: c.latitude, lng: c.longitude)) }
                fit(points, on: map, animated: true)
            case .fitAll:
                fitAllBuses(on: map, animated: true)
            }
        }

        private func fitAllBuses(on map: MLNMapView, animated: Bool) {
            fit(busAnnotations.values.map { .init(lat: $0.coordinate.latitude, lng: $0.coordinate.longitude) }, on: map, animated: animated)
        }

        private func fit(_ points: [BusMath.LatLng], on map: MLNMapView, animated: Bool) {
            guard let box = BusMath.bounds(points) else { return }
            if points.count == 1 {
                map.setCenter(CLLocationCoordinate2D(latitude: box.southWest.lat, longitude: box.southWest.lng), zoomLevel: 15, animated: animated)
                return
            }
            let bounds = MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: box.southWest.lat, longitude: box.southWest.lng),
                ne: CLLocationCoordinate2D(latitude: box.northEast.lat, longitude: box.northEast.lng)
            )
            // Leave room for the labels above markers and the bottom panel.
            map.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 120, left: 60, bottom: 260, right: 60), animated: animated, completionHandler: nil)
        }

        // MARK: MLNMapViewDelegate

        nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            MainActor.assumeIsolated {
                styleLoaded = true
                sync()
            }
        }

        nonisolated func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
            MainActor.assumeIsolated {
                parent.onMapError("The map could not be loaded. Check your connection — bus positions are still listed below.")
            }
        }

        nonisolated func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            MainActor.assumeIsolated { () -> MLNAnnotationView? in
                if let bus = annotation as? BusAnnotation {
                    let view = (mapView.dequeueReusableAnnotationView(withIdentifier: BusMarkerView.reuseId) as? BusMarkerView)
                        ?? BusMarkerView(annotation: bus, reuseIdentifier: BusMarkerView.reuseId)
                    view.configure(bus, selected: bus.busId == parent.selectedBusId, compact: compact, mapDirection: mapView.direction)
                    return view
                }
                if let stop = annotation as? StopAnnotation {
                    let view = (mapView.dequeueReusableAnnotationView(withIdentifier: StopMarkerView.reuseId) as? StopMarkerView)
                        ?? StopMarkerView(annotation: stop, reuseIdentifier: StopMarkerView.reuseId)
                    view.configure(stop, selected: stop.stopId == parent.selectedStopId,
                                   passed: (parent.progress?.passedSequences ?? []).contains(stop.sequence))
                    return view
                }
                if annotation is StudentLocationAnnotation {
                    return mapView.dequeueReusableAnnotationView(withIdentifier: StudentDotView.reuseId)
                        ?? StudentDotView(annotation: annotation, reuseIdentifier: StudentDotView.reuseId)
                }
                return nil
            }
        }

        nonisolated func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }

        nonisolated func mapView(_ mapView: MLNMapView, didSelect annotation: MLNAnnotation) {
            MainActor.assumeIsolated {
                if let bus = annotation as? BusAnnotation { parent.onSelectBus(bus.busId) }
                if let stop = annotation as? StopAnnotation { parent.onSelectStop(stop.stopId) }
                // Selection is drawn by our own views; keep MapLibre's selection empty so
                // tapping the same marker again still fires.
                mapView.deselectAnnotation(annotation, animated: false)
            }
        }

        nonisolated func mapView(_ mapView: MLNMapView, strokeColorForShapeAnnotation annotation: MLNShape) -> UIColor {
            MainActor.assumeIsolated {
                (annotation as? RoutePolyline)?.travelled == true ? UIColor.systemGray : UIColor(red: 0.11, green: 0.44, blue: 0.92, alpha: 1)
            }
        }

        nonisolated func mapView(_ mapView: MLNMapView, lineWidthForPolylineAnnotation annotation: MLNPolyline) -> CGFloat {
            MainActor.assumeIsolated { (annotation as? RoutePolyline)?.travelled == true ? 4 : 5 }
        }

        nonisolated func mapView(_ mapView: MLNMapView, alphaForShapeAnnotation annotation: MLNShape) -> CGFloat {
            MainActor.assumeIsolated { (annotation as? RoutePolyline)?.travelled == true ? 0.55 : 0.9 }
        }

        nonisolated func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            MainActor.assumeIsolated {
                // Zoomed out: number-only labels. Re-apply icon rotation for the new map bearing.
                compact = mapView.zoomLevel < 12.5
                refreshViews(on: mapView)
            }
        }
    }
}
