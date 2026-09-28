//! War room use cases and the ports they need. No IO of its own: everything external comes in
//! through the traits in [`ports`].

pub mod locale;
pub mod ports;
mod service;
pub mod view;

pub use service::{AgentPorts, IncomingSignal, Ports, WarRoomService};
