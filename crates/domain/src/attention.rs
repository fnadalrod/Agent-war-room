use serde::{Deserialize, Serialize};

/// How much a session needs you. Variants are ordered by urgency, lowest to highest,
/// so the aggregate colour is simply the maximum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Attention {
    Offline,
    Idle,
    Working,
    Finished,
    NeedsYou,
}

impl Attention {
    /// States worth a desktop notification.
    pub fn is_alerting(self) -> bool {
        matches!(self, Attention::NeedsYou | Attention::Finished)
    }
}

#[cfg(test)]
mod tests {
    use super::Attention::*;

    #[test]
    fn urgency_order_drives_aggregate() {
        assert_eq!([Idle, NeedsYou, Working].into_iter().max(), Some(NeedsYou));
        assert_eq!([Offline, Finished, Working].into_iter().max(), Some(Finished));
    }
}
