// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "GardenApp",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .executable(
      name: "GardenApp",
      targets: ["GardenApp"]
    )
  ],
  targets: [
    .executableTarget(
      name: "GardenApp",
      path: "Sources"
    ),
    .testTarget(
      name: "GardenAppTests",
      dependencies: ["GardenApp"],
      path: "Tests"
    )
  ]
)
