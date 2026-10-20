//! Whether a message's remote images load.
//!
//! Remote images load by default (owner's choice, 2026-10-15), as in most
//! mail apps; Settings → Viewing can make the default "only people you've
//! written to" or "blocked" (`RemoteImages`). Known tracking pixels are
//! still stripped by the sanitizer either way. What stays blocked:
//!
//! - Spam, always: sender addresses there are often forged, and loading an
//!   image confirms the mailbox is live.
//! - Senders the user chose to block (`sender_image_prefs`, global).
//! - Trash, unless the user chose to load that sender's images.
//! - With a stricter default, senders it leaves out, unless the user chose
//!   to load their images.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Whether remote images load for senders without a saved choice
/// (Settings → Viewing).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RemoteImages {
    /// Load for everyone (outside Spam and Trash).
    #[default]
    Load,
    /// Load only for people you've sent mail to, from any account.
    Correspondents,
    /// Load for no one: each sender has to be allowed.
    Block,
}

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
    /// Blocked by the default in Settings ("Block"), sender has no choice.
    BlockedByDefault,
    /// The default loads only for people you've written to, and you
    /// haven't written to this sender.
    BlockedNotWrittenTo,
}

impl ImagePolicy {
    pub fn allows(self) -> bool {
        matches!(self, Self::LoadedByDefault | Self::LoadedForSender)
    }
}

/// What's known about one message's sender and where it is.
#[derive(Debug, Clone, Copy, Default)]
pub struct ImageContext {
    pub in_spam: bool,
    pub in_trash: bool,
    /// The saved per-sender choice (`Some(true)` load, `Some(false)`
    /// block), if any.
    pub sender_choice: Option<bool>,
    /// You've sent mail to the sender (only asked for `Correspondents`).
    pub wrote_to_sender: bool,
}

/// Decides for one message under the default `default`.
pub fn image_policy(default: RemoteImages, c: ImageContext) -> ImagePolicy {
    if c.in_spam {
        return ImagePolicy::BlockedInSpam;
    }
    match c.sender_choice {
        Some(true) => ImagePolicy::LoadedForSender,
        Some(false) => ImagePolicy::BlockedForSender,
        None if c.in_trash => ImagePolicy::BlockedInTrash,
        None => match default {
            RemoteImages::Load => ImagePolicy::LoadedByDefault,
            RemoteImages::Correspondents if c.wrote_to_sender => ImagePolicy::LoadedByDefault,
            RemoteImages::Correspondents => ImagePolicy::BlockedNotWrittenTo,
            RemoteImages::Block => ImagePolicy::BlockedByDefault,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image_policy(in_spam: bool, in_trash: bool, sender_choice: Option<bool>) -> ImagePolicy {
        super::image_policy(
            RemoteImages::Load,
            ImageContext {
                in_spam,
                in_trash,
                sender_choice,
                wrote_to_sender: false,
            },
        )
    }

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

    #[test]
    fn a_stricter_default_blocks_until_the_sender_is_allowed() {
        let stranger = ImageContext::default();
        let friend = ImageContext {
            wrote_to_sender: true,
            ..Default::default()
        };
        let allowed = ImageContext {
            sender_choice: Some(true),
            ..Default::default()
        };
        use RemoteImages::*;
        assert_eq!(
            super::image_policy(Block, stranger),
            ImagePolicy::BlockedByDefault
        );
        assert_eq!(
            super::image_policy(Block, friend),
            ImagePolicy::BlockedByDefault
        );
        assert_eq!(
            super::image_policy(Block, allowed),
            ImagePolicy::LoadedForSender
        );
        assert_eq!(
            super::image_policy(Correspondents, stranger),
            ImagePolicy::BlockedNotWrittenTo
        );
        assert_eq!(
            super::image_policy(Correspondents, friend),
            ImagePolicy::LoadedByDefault
        );
        assert_eq!(
            super::image_policy(Correspondents, allowed),
            ImagePolicy::LoadedForSender
        );
        // Spam stays blocked for friends too.
        let spam_friend = ImageContext {
            in_spam: true,
            ..friend
        };
        assert_eq!(
            super::image_policy(Load, spam_friend),
            ImagePolicy::BlockedInSpam
        );
    }
}
