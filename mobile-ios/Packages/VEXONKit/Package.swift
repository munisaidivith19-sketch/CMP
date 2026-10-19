// swift-tools-version:5.10
//
// VEXONKit — the platform-independent core of the VEXON iOS app: configuration,
// the API client, session/refresh handling, typed backend models, error mapping,
// safe logging and the bus-map maths. It depends only on Foundation, so its tests
// run with `swift test` on macOS, Linux or Windows without Xcode or a simulator.
import PackageDescription

let package = Package(
    name: "VEXONKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "VEXONKit", targets: ["VEXONKit"]),
    ],
    targets: [
        .target(
            name: "VEXONKit",
            swiftSettings: [.enableExperimentalFeature("StrictConcurrency")]
        ),
        .testTarget(
            name: "VEXONKitTests",
            dependencies: ["VEXONKit"]
        ),
    ]
)
