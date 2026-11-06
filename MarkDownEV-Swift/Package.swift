// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "MarkDownEV",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(
            name: "MarkDownEV",
            path: "Sources/MarkDownEV"
        ),
        .testTarget(
            name: "MarkDownEVTests",
            dependencies: ["MarkDownEV"],
            path: "Tests/MarkDownEVTests"
        ),
    ]
)
