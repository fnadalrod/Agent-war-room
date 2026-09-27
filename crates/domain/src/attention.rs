use serde::{Deserialize, Serialize};

/// Cuánto necesita una sesión de ti. El orden de las variantes es el de urgencia, de menor a mayor,
/// para que el color agregado sea simplemente el máximo.
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
    /// Transiciones que merecen un aviso de escritorio.
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
