// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "CourrierMac",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(name: "CourrierCore", targets: ["CourrierCore"]),
        .executable(name: "Courrier", targets: ["CourrierMac"]),
    ],
    targets: [
        .target(
            name: "CourrierCore",
            linkerSettings: [
                .linkedFramework("Security"),
                .linkedFramework("Network"),
            ]
        ),
        .executableTarget(
            name: "CourrierMac",
            dependencies: ["CourrierCore"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("UserNotifications"),
            ]
        ),
        .testTarget(
            name: "CourrierCoreTests",
            dependencies: ["CourrierCore"]
        ),
    ]
)
