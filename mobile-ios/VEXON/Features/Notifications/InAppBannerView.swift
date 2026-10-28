import SwiftUI

/// One pop-up shown while the app is open (system banners stay quiet in the
/// foreground — PushManager), for a new notification or chat message.
struct InAppBanner: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let text: String?
    let isChat: Bool
}

struct InAppBannerView: View {
    let banner: InAppBanner
    let onOpen: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: banner.isChat ? "bubble.left.fill" : "bell.fill")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(banner.isChat ? Theme.primary : Theme.warning, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(banner.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                if let text = banner.text, !text.isEmpty {
                    Text(text).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(.secondary).padding(6)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .gesture(DragGesture(minimumDistance: 10).onEnded { if $0.translation.height < 0 { onDismiss() } })
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens it")
    }
}
