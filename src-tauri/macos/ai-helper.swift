// Mailboat's bridge to Apple Intelligence (the Foundation Models framework,
// macOS 26+). Apple's model is only reachable from Swift, so Mailboat runs
// this small program the way it runs the Claude and Codex command-line
// tools: one JSON request on stdin, JSON lines on stdout. Built by
// src-tauri/build.rs; the protocol is read in mailboat_core::ai::apple.
//
// Requests:  {"op":"status"}
//            {"op":"respond","instructions":"…","prompt":"…","maxTokens":300}
// Replies:   {"type":"status","available":true}
//            {"type":"status","available":false,"reason":"notEnabled"}
//            {"type":"text","text":"everything so far"}   (repeated)
//            {"type":"done","text":"the whole answer"}
//            {"type":"error","kind":"tooLong","message":"…"}

import Foundation
import FoundationModels

struct Request: Decodable {
    let op: String
    let instructions: String?
    let prompt: String?
    let maxTokens: Int?
    let temperature: Double?
}

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

func fail(_ kind: String, _ message: String) -> Never {
    emit(["type": "error", "kind": kind, "message": message])
    exit(1)
}

func unavailableReason(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .deviceNotEligible: return "deviceNotEligible"
    case .appleIntelligenceNotEnabled: return "notEnabled"
    case .modelNotReady: return "modelNotReady"
    @unknown default: return "unknown"
    }
}

@main
struct Helper {
    static func main() async {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        guard let request = try? JSONDecoder().decode(Request.self, from: input) else {
            fail("invalid", "unreadable request")
        }
        let model = SystemLanguageModel.default
        switch request.op {
        case "status":
            switch model.availability {
            case .available:
                emit(["type": "status", "available": true])
            case .unavailable(let reason):
                emit(["type": "status", "available": false, "reason": unavailableReason(reason)])
            }
        case "respond":
            if case .unavailable(let reason) = model.availability {
                fail("unavailable", unavailableReason(reason))
            }
            let session = LanguageModelSession(model: model, instructions: request.instructions ?? "")
            let options = GenerationOptions(
                temperature: request.temperature,
                maximumResponseTokens: request.maxTokens
            )
            do {
                var text = ""
                for try await snapshot in session.streamResponse(to: request.prompt ?? "", options: options) {
                    text = snapshot.content
                    emit(["type": "text", "text": text])
                }
                emit(["type": "done", "text": text])
            } catch let error as LanguageModelSession.GenerationError {
                switch error {
                case .exceededContextWindowSize:
                    fail("tooLong", "The conversation is too long for Apple Intelligence.")
                case .guardrailViolation, .refusal:
                    fail("refused", "Apple Intelligence declined to answer.")
                case .unsupportedLanguageOrLocale:
                    fail("language", "Apple Intelligence doesn’t support this language yet.")
                case .rateLimited:
                    fail("busy", "Apple Intelligence is busy; try again in a moment.")
                default:
                    fail("other", error.localizedDescription)
                }
            } catch {
                fail("other", error.localizedDescription)
            }
        default:
            fail("invalid", "unknown op \(request.op)")
        }
    }
}
