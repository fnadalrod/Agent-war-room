//! Public API prices and context windows of Claude models, to estimate what a session costs.
//! Source: Anthropic's model table (per million tokens). Subscriptions don't pay this; the
//! estimate is for comparing sessions and noticing expensive ones.

/// Dollars per million tokens.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
}

impl Price {
    const fn new(input: f64, output: f64, cache_read: f64) -> Self {
        Self { input, output, cache_read }
    }

    /// Cache writes cost 1.25× input with the 5-minute TTL and 2× with the 1-hour TTL.
    pub fn cache_write_5m(&self) -> f64 {
        self.input * 1.25
    }

    pub fn cache_write_1h(&self) -> f64 {
        self.input * 2.0
    }
}

/// Longest prefix first: `opus-4-5` must not be caught by `opus-4`.
const TABLE: &[(&str, Price, u64)] = &[
    ("fable-5-1", Price::new(10.0, 50.0, 0.25), 1_000_000),
    ("mythos-5-1", Price::new(10.0, 50.0, 0.25), 1_000_000),
    ("fable-5", Price::new(10.0, 50.0, 1.0), 1_000_000),
    ("mythos-5", Price::new(10.0, 50.0, 1.0), 1_000_000),
    ("opus-5-5", Price::new(4.0, 20.0, 0.20), 1_000_000),
    ("opus-5", Price::new(5.0, 25.0, 0.50), 1_000_000),
    ("opus-4-8", Price::new(5.0, 25.0, 0.50), 1_000_000),
    ("opus-4-7", Price::new(5.0, 25.0, 0.50), 1_000_000),
    ("opus-4-6", Price::new(5.0, 25.0, 0.50), 1_000_000),
    ("opus-4-5", Price::new(5.0, 25.0, 0.50), 200_000),
    ("opus-4", Price::new(15.0, 75.0, 1.50), 200_000),
    ("sonnet-5", Price::new(2.0, 10.0, 0.20), 1_000_000),
    ("sonnet-4-6", Price::new(3.0, 15.0, 0.30), 1_000_000),
    ("sonnet-4", Price::new(3.0, 15.0, 0.30), 200_000),
    ("haiku-4-5", Price::new(1.0, 5.0, 0.10), 200_000),
    ("haiku-3-5", Price::new(0.80, 4.0, 0.08), 200_000),
];

/// `claude-opus-5-5`, `claude-opus-5-5[1m]`, `claude-sonnet-4-5-20250929` → table key.
fn entry(model: &str) -> Option<&'static (&'static str, Price, u64)> {
    let name = model.trim_start_matches("claude-");
    let name = name.split('[').next().unwrap_or(name);
    TABLE.iter().find(|(key, ..)| name == *key || name.starts_with(&format!("{key}-")))
}

pub fn price(model: &str) -> Option<Price> {
    entry(model).map(|(_, price, _)| *price)
}

pub fn context_window(model: &str) -> Option<u64> {
    let window = entry(model).map(|(.., window)| *window)?;
    // A `[1m]` suffix opts older models into the 1M window.
    Some(if model.contains("[1m]") { window.max(1_000_000) } else { window })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_ids_with_dates_and_suffixes_to_the_right_row() {
        assert_eq!(price("claude-opus-5-5").unwrap().input, 4.0);
        assert_eq!(price("claude-opus-5").unwrap().input, 5.0, "not opus-5-5");
        assert_eq!(price("claude-opus-4-5-20251101").unwrap().input, 5.0, "not opus-4");
        assert_eq!(price("claude-opus-4-1-20250805").unwrap().input, 15.0);
        assert_eq!(price("claude-sonnet-4-5-20250929").unwrap().output, 15.0);
        assert!(price("gpt-5").is_none());
        assert_eq!(context_window("claude-haiku-4-5"), Some(200_000));
        assert_eq!(context_window("claude-sonnet-4-5[1m]"), Some(1_000_000));
        assert_eq!(context_window("claude-opus-5-5"), Some(1_000_000));
    }
}
