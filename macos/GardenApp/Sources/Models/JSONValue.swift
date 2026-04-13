import Foundation

enum JSONValue: Codable, Equatable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()

    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      throw DecodingError.dataCorruptedError(
        in: container,
        debugDescription: "Unsupported JSON value."
      )
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()

    switch self {
    case .string(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .bool(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    }
  }

  var foundationValue: Any {
    switch self {
    case .string(let value):
      return value
    case .number(let value):
      return value
    case .bool(let value):
      return value
    case .object(let value):
      return value.mapValues(\.foundationValue)
    case .array(let value):
      return value.map(\.foundationValue)
    case .null:
      return NSNull()
    }
  }
}

extension Dictionary where Key == String, Value == JSONValue {
  var prettyPrintedJSONString: String {
    guard
      JSONSerialization.isValidJSONObject(self.mapValues(\.foundationValue)),
      let data = try? JSONSerialization.data(
        withJSONObject: self.mapValues(\.foundationValue),
        options: [.prettyPrinted, .sortedKeys]
      ),
      let string = String(data: data, encoding: .utf8)
    else {
      return "{}"
    }

    return string
  }
}
