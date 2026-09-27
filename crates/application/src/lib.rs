//! Casos de uso de la war room y los puertos que necesitan. Sin IO propio: todo lo externo entra
//! por los traits de [`ports`].

pub mod ports;
mod service;
pub mod view;

pub use service::{IncomingSignal, Ports, WarRoomService};
