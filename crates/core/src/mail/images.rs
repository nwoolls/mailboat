//! Whether a message's remote images load.
//!
//! Remote images load by default (owner's choice, 2026-10-15), as in most
//! mail apps. Known tracking pixels are still stripped by the sanitizer
//! either way. What stays blocked:
//!
//! - Spam, always: sender addresses there are often forged, and loading an
//!   image confirms the mailbox is live.
//! - Senders the user chose to block (`sender_image_prefs`, global).
//! - Trash, unless the user chose to load that sender's images.

use serde::{Deserialize, Serialize};
use specta::Type;

/// The decision, and why, so the reader can offer the right choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ImagePolicy {
    /// Nothing special about this sender: images load.
    LoadedByDefault,
    /// The user chose to load this sender's images.
    LoadedForSender,
    /// The user chose to block this sender's images.
    BlockedForSender,
    /// The message is in Spam.
    BlockedInSpam,
    /// The message is in Trash and the sender has no saved choice.
    BlockedInTrash,
}

impl ImagePolicy {
    pub fn allows(self) -> bool {
        matches!(self, Self::LoadedByDefault | Self::LoadedForSender)
    }
}

/// Decides for one message. `sender_choice` is the saved per-sender choice
/// (`Some(true)` load, `Some(false)` block), if any.
pub fn image_policy(in_spam: bool, in_trash: bool, sender_choice: Option<bool>) -> ImagePolicy {
    if in_spam {
        return ImagePolicy::BlockedInSpam;
    }
    match sender_choice {
        Some(true) => ImagePolicy::LoadedForSender,
        Some(false) => ImagePolicy::BlockedForSender,
        None if in_trash => ImagePolicy::BlockedInTrash,
        None => ImagePolicy::LoadedByDefault,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_load_by_default() {
        assert_eq!(
            image_policy(false, false, None),
            ImagePolicy::LoadedByDefault
        );
        assert!(ImagePolicy::LoadedByDefault.allows());
    }

    #[test]
    fn spam_is_always_blocked_even_for_an_allowed_sender() {
        assert_eq!(
            image_policy(true, false, Some(true)),
            ImagePolicy::BlockedInSpam
        );
        assert_eq!(image_policy(true, false, None), ImagePolicy::BlockedInSpam);
        assert!(!ImagePolicy::BlockedInSpam.allows());
    }

    #[test]
    fn a_saved_sender_choice_wins_outside_spam() {
        assert_eq!(
            image_policy(false, false, Some(false)),
            ImagePolicy::BlockedForSender
        );
        assert_eq!(
            image_policy(false, true, Some(true)),
            ImagePolicy::LoadedForSender
        );
    }

    #[test]
    fn trash_blocks_unless_the_sender_is_allowed() {
        assert_eq!(image_policy(false, true, None), ImagePolicy::BlockedInTrash);
    }
}
