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
                Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Dismiss")
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .padding(.vertical, 8)
        .glass(cornerRadius: 22)
        .frame(maxWidth: 520)
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .onTapGesture(perform: onOpen)
        .gesture(DragGesture(minimumDistance: 10).onEnded { if $0.translation.height < 0 { onDismiss() } })
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens it")
    }
}
