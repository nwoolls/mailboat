// The app's bridge to Apple Intelligence (the Foundation Models framework,
// macOS 26+) and Apple's on-device translation (the Translation framework). Apple's model is only reachable from Swift, so the app runs
// this small program the way it runs the Claude and Codex command-line
// tools: one JSON request on stdin, JSON lines on stdout. Built by
// src-tauri/build.rs; the protocol is read in mail_core::ai::apple.
//
// Requests:  {"op":"status"}
//            {"op":"respond","instructions":"…","prompt":"…","maxTokens":300}
//            {"op":"translate","prompt":"text","target":"en-US"}
//            {"op":"detect","prompt":"text"}
//            {"op":"languages"}
// Replies:   {"type":"status","available":true}
//            {"type":"status","available":false,"reason":"notEnabled"}
//            {"type":"text","text":"everything so far"}   (repeated)
//            {"type":"done","text":"the whole answer"}
//            {"type":"translated","text":"…","source":"fr","target":"en"}
//            {"type":"language","code":"fr"}            (code null: not sure)
//            {"type":"languages","codes":["de","en",…]}
//            {"type":"error","kind":"tooLong","message":"…"}
//
// Translation runs only for languages already downloaded on the Mac
// (System Settings → General → Language & Region → Translation
// Languages): a download needs a window to ask in. Otherwise it fails
// with kind "notInstalled" or "unsupported", and the app asks the writing
// provider instead.

import Foundation
import FoundationModels
import NaturalLanguage
import Translation

struct Request: Decodable {
    let op: String
    let instructions: String?
    let prompt: String?
    let maxTokens: Int?
    let temperature: Double?
    let target: String?
}

/// The language a text is written in, when the guess is confident.
func detect(_ text: String) -> Locale.Language? {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    guard let best = recognizer.languageHypotheses(withMaximum: 1).first, best.value > 0.5 else {
        return nil
    }
    return Locale.Language(identifier: best.key.rawValue)
}

func code(_ language: Locale.Language) -> String {
    language.minimalIdentifier
}

func translate(_ text: String, target: String?) async {
    guard let source = detect(text) else {
        fail("unknownLanguage", "Couldn’t tell which language that is.")
    }
    let target = target.map { Locale.Language(identifier: $0) } ?? Locale.current.language
    if source.languageCode == target.languageCode {
        fail("sameLanguage", "That’s already in \(code(target)).")
    }
    switch await LanguageAvailability().status(from: source, to: target) {
    case .installed:
        break
    case .supported:
        fail("notInstalled", "\(code(source)) → \(code(target)) isn’t downloaded on this Mac.")
    case .unsupported:
        fail("unsupported", "\(code(source)) → \(code(target)) isn’t offered by Apple’s translation.")
    @unknown default:
        fail("unsupported", "Apple’s translation can’t do \(code(source)) → \(code(target)).")
    }
    do {
        let session = TranslationSession(installedSource: source, target: target)
        let response = try await session.translate(text)
        emit([
            "type": "translated", "text": response.targetText,
            "source": code(response.sourceLanguage), "target": code(response.targetLanguage),
        ])
    } catch {
        fail("other", error.localizedDescription)
    }
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
        case "translate":
            await translate(request.prompt ?? "", target: request.target)
        case "detect":
            emit(["type": "language", "code": detect(request.prompt ?? "").map(code) ?? NSNull()])
        case "languages":
            let codes = await LanguageAvailability().supportedLanguages.map(code)
            emit(["type": "languages", "codes": Array(Set(codes)).sorted()])
        default:
            fail("invalid", "unknown op \(request.op)")
        }
    }
}
