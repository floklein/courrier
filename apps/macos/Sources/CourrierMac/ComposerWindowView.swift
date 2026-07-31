import AppKit
import CourrierCore
import SwiftUI
import UniformTypeIdentifiers

struct ComposerWindowView: View {
    @EnvironmentObject private var mailbox: MailboxStore
    @EnvironmentObject private var composer: ComposerModel
    @Environment(\.dismiss) private var dismiss
    @State private var importsFiles = false
    @State private var isDropTarget = false

    var body: some View {
        VStack(spacing: 0) {
            recipients
            Divider()

            HStack {
                Text("Subject")
                    .foregroundStyle(.secondary)
                    .frame(width: 54, alignment: .trailing)
                TextField("Subject", text: $composer.subject)
                    .textFieldStyle(.plain)
                    .font(.headline)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            Divider()
            formattingBar
            Divider()

            RichTextEditor(text: $composer.body)
                .padding(8)
                .overlay {
                    if isDropTarget {
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6]))
                            .padding(8)
                    }
                }
                .dropDestination(for: URL.self) { urls, _ in
                    composer.addFiles(urls)
                    return !urls.isEmpty
                } isTargeted: {
                    isDropTarget = $0
                }

            if !composer.attachments.isEmpty {
                Divider()
                attachmentBar
            }

            if let validation = composer.validationMessage {
                Divider()
                Label(validation, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
            }

            Divider()
            bottomBar
        }
        .task {
            if composer.accountID == nil {
                composer.prepareNew()
            }
        }
        .onAppear {
            composer.scheduleAutosave()
        }
        .onChange(of: composer.autosaveSignature) { _, _ in
            composer.scheduleAutosave()
        }
        .fileImporter(
            isPresented: $importsFiles,
            allowedContentTypes: [.data],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                composer.addFiles(urls)
            }
        }
    }

    private var recipients: some View {
        VStack(spacing: 0) {
            RecipientLine(label: "To", value: $composer.to)

            if composer.showsCc {
                RecipientLine(label: "Cc", value: $composer.cc)
            }
            if composer.showsBcc {
                RecipientLine(label: "Bcc", value: $composer.bcc)
            }

            if !composer.showsCc || !composer.showsBcc {
                HStack {
                    Spacer()
                    if !composer.showsCc {
                        Button("Cc") { composer.showsCc = true }
                            .buttonStyle(.link)
                    }
                    if !composer.showsBcc {
                        Button("Bcc") { composer.showsBcc = true }
                            .buttonStyle(.link)
                    }
                }
                .font(.caption)
                .padding(.horizontal, 14)
                .padding(.bottom, 7)
            }
        }
    }

    private var formattingBar: some View {
        HStack(spacing: 4) {
            formatButton("Bold", systemImage: "bold", action: Selector(("toggleBoldface:")))
            formatButton("Italic", systemImage: "italic", action: Selector(("toggleItalics:")))
            formatButton(
                "Underline",
                systemImage: "underline",
                action: #selector(NSTextView.underline(_:))
            )
            Divider().frame(height: 18)
            Button {
                NSColorPanel.shared.orderFront(nil)
            } label: {
                Image(systemName: "paintpalette")
            }
            .help("Text Color")
            Spacer()
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var attachmentBar: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(composer.attachments) { attachment in
                    HStack(spacing: 6) {
                        Image(systemName: "paperclip")
                        VStack(alignment: .leading, spacing: 1) {
                            Text(attachment.name).lineLimit(1)
                            Text(
                                ByteCountFormatter.string(
                                    fromByteCount: Int64(attachment.data.count),
                                    countStyle: .file
                                )
                            )
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                        Button {
                            composer.attachments.removeAll { $0.id == attachment.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.borderless)
                        .help("Remove \(attachment.name)")
                    }
                    .font(.caption)
                    .padding(7)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 7))
                }
            }
            .padding(9)
        }
        .frame(maxHeight: 70)
    }

    private var bottomBar: some View {
        HStack {
            Button {
                Task {
                    if await composer.send() {
                        dismiss()
                    }
                }
            } label: {
                if composer.isSending {
                    ProgressView().controlSize(.small)
                } else {
                    Label("Send", systemImage: "paperplane.fill")
                }
            }
            .keyboardShortcut(.return, modifiers: .command)
            .buttonStyle(.borderedProminent)
            .disabled(composer.isSending)

            Button {
                importsFiles = true
            } label: {
                Label("Attach", systemImage: "paperclip")
            }
            .help("Attach Files")

            Spacer()

            Text(autosaveLabel)
                .font(.caption)
                .foregroundStyle(
                    composer.autosaveState == .failed ? Color.red : Color.secondary
                )
        }
        .padding(10)
    }

    private var autosaveLabel: String {
        switch composer.autosaveState {
        case .idle: ""
        case .saving: "Saving draft..."
        case .saved: "Draft saved"
        case .failed: "Draft could not be saved"
        }
    }

    private func formatButton(
        _ label: String,
        systemImage: String,
        action: Selector
    ) -> some View {
        Button {
            NSApp.sendAction(action, to: nil, from: nil)
        } label: {
            Image(systemName: systemImage)
        }
        .help(label)
    }
}

private struct RecipientLine: View {
    @EnvironmentObject private var mailbox: MailboxStore
    let label: String
    @Binding var value: String
    @FocusState private var focused: Bool
    @State private var suggestions: [PersonSuggestion] = []

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(label)
                    .foregroundStyle(.secondary)
                    .frame(width: 54, alignment: .trailing)
                TextField("name@example.com", text: $value)
                    .textFieldStyle(.plain)
                    .focused($focused)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)

            if focused && !suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(suggestions.prefix(6)) { person in
                        Button {
                            append(person)
                        } label: {
                            HStack {
                                MessageAvatar(
                                    address: MailAddress(name: person.name, email: person.email)
                                )
                                .scaleEffect(0.72)
                                .frame(width: 28, height: 28)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(person.name)
                                    Text(person.email)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 72)
                        .padding(.vertical, 3)
                    }
                }
                .background(.bar)
            }
        }
        .task(id: value) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled, focused else { return }
            let query = value
                .split(whereSeparator: { $0 == "," || $0 == ";" })
                .last?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            suggestions = await mailbox.people(query: query)
        }
        .onChange(of: focused) { _, isFocused in
            if !isFocused { suggestions = [] }
        }
    }

    private func append(_ person: PersonSuggestion) {
        var parts = value.split(whereSeparator: { $0 == "," || $0 == ";" }).map(String.init)
        if !parts.isEmpty { parts.removeLast() }
        parts.append(
            RecipientParser.serialize([
                MailAddress(name: person.name, email: person.email),
            ])
        )
        value = parts.joined(separator: ", ") + ", "
        suggestions = []
    }
}

struct RichTextEditor: NSViewRepresentable {
    @Binding var text: NSAttributedString

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder

        let textView = NSTextView()
        textView.delegate = context.coordinator
        textView.isRichText = true
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.isAutomaticLinkDetectionEnabled = true
        textView.isContinuousSpellCheckingEnabled = true
        textView.isGrammarCheckingEnabled = true
        textView.textContainerInset = NSSize(width: 10, height: 10)
        textView.font = .preferredFont(forTextStyle: .body)
        textView.textStorage?.setAttributedString(text)
        textView.autoresizingMask = [.width]
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.textContainer?.widthTracksTextView = true
        scrollView.documentView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView,
              !textView.attributedString().isEqual(to: text) else {
            return
        }
        let selection = textView.selectedRange()
        textView.textStorage?.setAttributedString(text)
        textView.setSelectedRange(
            NSRange(
                location: min(selection.location, text.length),
                length: min(selection.length, max(0, text.length - selection.location))
            )
        )
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var text: NSAttributedString

        init(text: Binding<NSAttributedString>) {
            _text = text
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            text = textView.attributedString()
        }
    }
}
