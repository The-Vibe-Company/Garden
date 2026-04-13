import AppKit
import SwiftUI

final class GardenAppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
  }
}

@main
struct GardenNativeApp: App {
  @NSApplicationDelegateAdaptor(GardenAppDelegate.self) private var appDelegate
  @State private var model = GardenViewModel()

  var body: some Scene {
    WindowGroup("Garden", id: "main") {
      ContentView(model: model)
    }
    .defaultSize(width: 920, height: 620)
    .commands {
      CommandGroup(replacing: .newItem) {}
    }

    MenuBarExtra {
      GardenMenuBarView(model: model)
    } label: {
      Label(model.menuBarTitle, systemImage: model.menuBarSystemImage)
    }
    .menuBarExtraStyle(.window)
  }
}
