import Foundation

private struct CommandOutput: Sendable {
  let command: String
  let stdout: String
  let stderr: String
  let exitCode: Int32
}

private struct GardenCLIInvocation: Sendable {
  let command: String
  let prefixArguments: [String]

  var displayCommand: String {
    ([command] + prefixArguments).map(GardenCLIClient.shellQuote).joined(separator: " ")
  }
}

enum GardenCLIClientError: LocalizedError {
  case cliUnavailable
  case nodeUnavailable
  case commandFailed(command: String, exitCode: Int32, stderr: String, stdout: String)
  case invalidJSON(command: String, detail: String)

  var errorDescription: String? {
    switch self {
    case .cliUnavailable:
      return "Garden CLI was not found. Link the `garden` command or build the repo so `dist/src/cli.js` is available."
    case .nodeUnavailable:
      return "Node.js was not found. Garden CLI commands require `node` to be available in your shell."
    case .commandFailed(_, let exitCode, let stderr, let stdout):
      let detail = [stderr.trimmingCharacters(in: .whitespacesAndNewlines), stdout.trimmingCharacters(in: .whitespacesAndNewlines)]
        .first { !$0.isEmpty } ?? "Command exited with status \(exitCode)."
      return detail
    case .invalidJSON(_, let detail):
      return "Garden returned malformed JSON. \(detail)"
    }
  }
}

protocol GardenCLIProviding: Sendable {
  func status() async throws -> GardenStatusSummary
  func today() async throws -> TodaySummary
  func attentionList() async throws -> [AttentionItem]
  func workflowList() async throws -> [WorkflowSummary]
  func resolveAttentionItem(id: Int) async throws
  func snoozeAttentionItem(id: Int, until: Date) async throws
  func runWorkflow(id: String) async throws -> WorkflowRunCommandResult
  func runWorkflowStream(
    id: String,
    onEvent: @escaping @Sendable (WorkflowStreamEvent) async -> Void
  ) async throws -> WorkflowRunCommandResult
}

actor GardenCLIClient: GardenCLIProviding {
  private let environment: [String: String]
  private var cachedInvocation: GardenCLIInvocation?

  init(environment: [String: String] = ProcessInfo.processInfo.environment) {
    self.environment = environment
  }

  func status() async throws -> GardenStatusSummary {
    try await runAndDecode(["status", "--json"], as: GardenStatusSummary.self)
  }

  func today() async throws -> TodaySummary {
    try await runAndDecode(["today", "--json"], as: TodaySummary.self)
  }

  func attentionList() async throws -> [AttentionItem] {
    try await runAndDecode(["attention", "list", "--json"], as: [AttentionItem].self)
  }

  func workflowList() async throws -> [WorkflowSummary] {
    try await runAndDecode(["workflow", "list", "--json"], as: [WorkflowSummary].self)
  }

  func resolveAttentionItem(id: Int) async throws {
    _ = try await runCommand(["attention", "resolve", String(id)])
  }

  func snoozeAttentionItem(id: Int, until: Date) async throws {
    _ = try await runCommand([
      "attention",
      "snooze",
      String(id),
      "--until",
      Self.cliDateString(from: until)
    ])
  }

  func runWorkflow(id: String) async throws -> WorkflowRunCommandResult {
    try await runAndDecode(
      ["workflow", "run", id, "--json"],
      as: WorkflowRunCommandResult.self,
      allowNonZeroExit: true
    )
  }

  func runWorkflowStream(
    id: String,
    onEvent: @escaping @Sendable (WorkflowStreamEvent) async -> Void
  ) async throws -> WorkflowRunCommandResult {
    let invocation = try await invocation()
    let arguments = invocation.prefixArguments + ["workflow", "run", id, "--stream-jsonl"]

    return try await Self.runStreamingProcess(
      invocation: invocation,
      arguments: arguments,
      environment: environment,
      onEvent: onEvent
    )
  }

  private func runAndDecode<T: Decodable>(
    _ arguments: [String],
    as type: T.Type,
    allowNonZeroExit: Bool = false
  ) async throws -> T {
    let output = try await runCommand(arguments, allowNonZeroExit: allowNonZeroExit)
    let data = Data(output.stdout.utf8)

    guard !data.isEmpty else {
      throw GardenCLIClientError.invalidJSON(
        command: output.command,
        detail: "Garden returned no JSON output."
      )
    }

    do {
      return try Self.jsonDecoder.decode(type, from: data)
    } catch {
      throw GardenCLIClientError.invalidJSON(
        command: output.command,
        detail: error.localizedDescription
      )
    }
  }

  private func runCommand(
    _ arguments: [String],
    allowNonZeroExit: Bool = false
  ) async throws -> CommandOutput {
    let invocation = try await invocation()
    let output = try await Self.runProcess(
      invocation: invocation,
      arguments: invocation.prefixArguments + arguments,
      environment: environment
    )

    if output.exitCode != 0 && (!allowNonZeroExit || isEnvironmentFailure(output)) {
      throw error(from: output)
    }

    return output
  }

  private func invocation() async throws -> GardenCLIInvocation {
    if let cachedInvocation {
      return cachedInvocation
    }

    if let customCLIPath = environment["GARDEN_CLI_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines),
       !customCLIPath.isEmpty {
      let invocation = try await customInvocation(cliPath: customCLIPath)
      cachedInvocation = invocation
      return invocation
    }

    if let developmentCLIPath = developmentCLIPath(),
       let nodeCommand = try? await resolvedNodeCommand() {
      let invocation = GardenCLIInvocation(command: nodeCommand, prefixArguments: [developmentCLIPath])
      cachedInvocation = invocation
      return invocation
    }

    if let gardenCommand = await Self.shellCommandPath("garden") {
      let invocation = GardenCLIInvocation(command: gardenCommand, prefixArguments: [])
      cachedInvocation = invocation
      return invocation
    }

    if let developmentCLIPath = developmentCLIPath() {
      let nodeCommand = try await resolvedNodeCommand()
      let invocation = GardenCLIInvocation(command: nodeCommand, prefixArguments: [developmentCLIPath])
      cachedInvocation = invocation
      return invocation
    }

    throw GardenCLIClientError.cliUnavailable
  }

  private func customInvocation(cliPath: String) async throws -> GardenCLIInvocation {
    let expandedPath = (cliPath as NSString).expandingTildeInPath
    if expandedPath.hasSuffix(".js") {
      let nodeCommand = try await resolvedNodeCommand()
      return GardenCLIInvocation(command: nodeCommand, prefixArguments: [expandedPath])
    }

    return GardenCLIInvocation(command: expandedPath, prefixArguments: [])
  }

  private func resolvedNodeCommand() async throws -> String {
    if let customNodePath = environment["GARDEN_NODE_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines),
       !customNodePath.isEmpty {
      return (customNodePath as NSString).expandingTildeInPath
    }

    if let nodePath = await Self.shellCommandPath("node") {
      return nodePath
    }

    if let nodePath = Self.commonNodePath() {
      return nodePath
    }

    throw GardenCLIClientError.nodeUnavailable
  }

  private func developmentCLIPath() -> String? {
    let fileManager = FileManager.default
    let searchRoots = [
      Bundle.main.bundleURL.resolvingSymlinksInPath(),
      URL(filePath: fileManager.currentDirectoryPath).resolvingSymlinksInPath()
    ]

    for root in searchRoots {
      var cursor = root
      for _ in 0..<10 {
        let candidate = cursor.appendingPathComponent("dist/src/cli.js")
        if fileManager.fileExists(atPath: candidate.path) {
          return candidate.path
        }

        let parent = cursor.deletingLastPathComponent()
        if parent.path == cursor.path {
          break
        }
        cursor = parent
      }
    }

    return nil
  }

  private func isEnvironmentFailure(_ output: CommandOutput) -> Bool {
    let combined = "\(output.stderr)\n\(output.stdout)"
    return output.exitCode == 127 || combined.contains("command not found")
  }

  private func error(from output: CommandOutput) -> GardenCLIClientError {
    let combined = "\(output.stderr)\n\(output.stdout)"
    if combined.contains("node: command not found") || combined.contains("command not found: node") {
      return .nodeUnavailable
    }

    if combined.contains("garden: command not found") || combined.contains("command not found: garden") {
      return .cliUnavailable
    }

    return .commandFailed(
      command: output.command,
      exitCode: output.exitCode,
      stderr: output.stderr,
      stdout: output.stdout
    )
  }

  private static func shellCommandExists(_ command: String) async -> Bool {
    await shellCommandPath(command) != nil
  }

  private static func shellCommandPath(_ command: String) async -> String? {
    let lookup = "command -v \(shellQuote(command))"
    guard let output = try? await runShellCommand(lookup) else {
      return nil
    }

    guard output.exitCode == 0 else {
      return nil
    }

    let path = output.stdout
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .split(separator: "\n")
      .map(String.init)
      .first

    guard let path, !path.isEmpty else {
      return nil
    }

    return path
  }

  private static func commonNodePath() -> String? {
    let fileManager = FileManager.default
    let homeDirectory = fileManager.homeDirectoryForCurrentUser.path
    let directCandidates = [
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node"
    ]

    for candidate in directCandidates where fileManager.isExecutableFile(atPath: candidate) {
      return candidate
    }

    let nvmRoot = URL(fileURLWithPath: homeDirectory, isDirectory: true)
      .appendingPathComponent(".nvm/versions/node", isDirectory: true)
    guard let versionDirectories = try? fileManager.contentsOfDirectory(
      at: nvmRoot,
      includingPropertiesForKeys: [.nameKey],
      options: [.skipsHiddenFiles]
    ) else {
      return nil
    }

    let candidates = versionDirectories
      .map { $0.appendingPathComponent("bin/node", isDirectory: false).path }
      .filter { fileManager.isExecutableFile(atPath: $0) }
      .sorted()

    return candidates.last
  }

  private static func runShellCommand(_ command: String) async throws -> CommandOutput {
    try await Task.detached(priority: .userInitiated) {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/zsh")
      process.arguments = ["-lc", command]

      let stdoutPipe = Pipe()
      let stderrPipe = Pipe()
      process.standardOutput = stdoutPipe
      process.standardError = stderrPipe

      try process.run()
      process.waitUntilExit()

      let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
      let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()

      return CommandOutput(
        command: command,
        stdout: String(decoding: stdoutData, as: UTF8.self),
        stderr: String(decoding: stderrData, as: UTF8.self),
        exitCode: process.terminationStatus
      )
    }.value
  }

  private static func runProcess(
    invocation: GardenCLIInvocation,
    arguments: [String],
    environment: [String: String]
  ) async throws -> CommandOutput {
    try await Task.detached(priority: .userInitiated) {
      let process = Process()
      let (executable, processArguments) = resolveExecutable(command: invocation.command, arguments: arguments)
      process.executableURL = URL(fileURLWithPath: executable)
      process.arguments = processArguments
      process.environment = environment

      let stdoutPipe = Pipe()
      let stderrPipe = Pipe()
      process.standardOutput = stdoutPipe
      process.standardError = stderrPipe

      try process.run()
      process.waitUntilExit()

      let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
      let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()

      return CommandOutput(
        command: ([invocation.displayCommand] + arguments.dropFirst(invocation.prefixArguments.count)).joined(separator: " "),
        stdout: String(decoding: stdoutData, as: UTF8.self),
        stderr: String(decoding: stderrData, as: UTF8.self),
        exitCode: process.terminationStatus
      )
    }.value
  }

  private static func runStreamingProcess(
    invocation: GardenCLIInvocation,
    arguments: [String],
    environment: [String: String],
    onEvent: @escaping @Sendable (WorkflowStreamEvent) async -> Void
  ) async throws -> WorkflowRunCommandResult {
    try await Task.detached(priority: .userInitiated) {
      let process = Process()
      let (executable, processArguments) = resolveExecutable(command: invocation.command, arguments: arguments)
      process.executableURL = URL(fileURLWithPath: executable)
      process.arguments = processArguments
      process.environment = environment

      let stdoutPipe = Pipe()
      let stderrPipe = Pipe()
      process.standardOutput = stdoutPipe
      process.standardError = stderrPipe

      try process.run()

      let stdoutTask = Task.detached(priority: .userInitiated) { () throws -> (WorkflowStreamEvent?, String) in
        var terminalEvent: WorkflowStreamEvent?
        var rawOutput = ""

        for try await line in stdoutPipe.fileHandleForReading.bytes.lines {
          guard !line.isEmpty else {
            continue
          }

          rawOutput += line
          rawOutput += "\n"

          let data = Data(line.utf8)
          let event = try jsonDecoder.decode(WorkflowStreamEvent.self, from: data)
          if event.type == .runCompleted || event.type == .runSkipped {
            terminalEvent = event
          }
          await onEvent(event)
        }

        return (terminalEvent, rawOutput)
      }

      let stderrTask = Task.detached(priority: .utility) { () -> String in
        var output = ""
        for try await line in stderrPipe.fileHandleForReading.bytes.lines {
          output += line
          output += "\n"
        }
        return output
      }

      process.waitUntilExit()

      let exitCode = process.terminationStatus
      let (terminalEvent, rawOutput) = try await stdoutTask.value
      let stderr = (try? await stderrTask.value) ?? ""
      let command = ([invocation.displayCommand] + arguments.dropFirst(invocation.prefixArguments.count)).joined(separator: " ")

      if let terminalEvent, let run = terminalEvent.run {
        return WorkflowRunCommandResult(
          skipped: terminalEvent.type == .runSkipped || terminalEvent.skipped == true,
          run: run
        )
      }

      if exitCode != 0 {
        throw GardenCLIClientError.commandFailed(
          command: command,
          exitCode: exitCode,
          stderr: stderr,
          stdout: rawOutput
        )
      }

      throw GardenCLIClientError.invalidJSON(
        command: command,
        detail: "Garden did not emit a terminal workflow event."
      )
    }.value
  }

  private static func resolveExecutable(command: String, arguments: [String]) -> (String, [String]) {
    if command.contains("/") {
      return (command, arguments)
    }

    return ("/usr/bin/env", [command] + arguments)
  }

  static func shellQuote(_ value: String) -> String {
    if value.isEmpty {
      return "''"
    }

    return "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
  }

  private static func cliDateString(from date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }

  private static func parseISODate(_ string: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: string) {
      return date
    }

    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: string)
  }

  private static let jsonDecoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      let string = try container.decode(String.self)

      if let date = parseISODate(string) {
        return date
      }

      throw DecodingError.dataCorruptedError(
        in: container,
        debugDescription: "Invalid ISO-8601 date: \(string)"
      )
    }
    return decoder
  }()
}
