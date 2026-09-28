use awr_application::ports::{EventStore, PortError, PortResult};
use awr_domain::{SessionEvent, Timestamp};
use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::Mutex;

/// Almacén append-only de eventos. El estado se reconstruye plegándolos.
pub struct SqliteEventStore {
    conn: Mutex<Connection>,
}

impl SqliteEventStore {
    pub fn open(path: &Path) -> PortResult<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(fail)?;
        }
        Self::init(Connection::open(path).map_err(fail)?)
    }

    pub fn in_memory() -> PortResult<Self> {
        Self::init(Connection::open_in_memory().map_err(fail)?)
    }

    fn init(conn: Connection) -> PortResult<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS events (
                 id      INTEGER PRIMARY KEY AUTOINCREMENT,
                 at      INTEGER NOT NULL,
                 session TEXT    NOT NULL,
                 body    TEXT    NOT NULL
             );
             CREATE INDEX IF NOT EXISTS events_at ON events (at);",
        )
        .map_err(fail)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

impl EventStore for SqliteEventStore {
    fn append(&self, event: &SessionEvent) -> PortResult<()> {
        let body = serde_json::to_string(event).map_err(fail)?;
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO events (at, session, body) VALUES (?1, ?2, ?3)",
                params![event.at.0, event.session.0, body],
            )
            .map(drop)
            .map_err(fail)
    }

    fn load_since(&self, since: Timestamp) -> PortResult<Vec<SessionEvent>> {
        let conn = self.conn.lock().unwrap();
        // Orden de inserción, no de `at`: es el orden en que se aplicaron.
        let mut stmt = conn.prepare("SELECT body FROM events WHERE at >= ?1 ORDER BY id").map_err(fail)?;
        let rows = stmt
            .query_map(params![since.0], |row| row.get::<_, String>(0))
            .map_err(fail)?;
        let mut events = Vec::new();
        for body in rows {
            // Un evento ilegible (p. ej. de una versión futura) no debe impedir arrancar.
            if let Ok(event) = serde_json::from_str(&body.map_err(fail)?) {
                events.push(event);
            }
        }
        Ok(events)
    }

    fn prune(&self, before: Timestamp) -> PortResult<usize> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM events WHERE at < ?1", params![before.0])
            .map_err(fail)
    }
}

fn fail(e: impl ToString) -> PortError {
    PortError::Failed(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use awr_domain::{SessionEventKind, SessionId};

    fn event(at: i64, kind: SessionEventKind) -> SessionEvent {
        SessionEvent { session: SessionId("s".into()), at: Timestamp(at), context: None, kind }
    }

    #[test]
    fn appends_and_loads_in_insertion_order_from_a_point_in_time() {
        let store = SqliteEventStore::in_memory().unwrap();
        store.append(&event(10, SessionEventKind::Seen)).unwrap();
        store.append(&event(30, SessionEventKind::Archived)).unwrap();
        store.append(&event(20, SessionEventKind::Muted)).unwrap();

        let loaded = store.load_since(Timestamp(15)).unwrap();
        let kinds: Vec<_> = loaded.into_iter().map(|e| e.kind).collect();
        assert_eq!(kinds, vec![SessionEventKind::Archived, SessionEventKind::Muted]);

        assert_eq!(store.prune(Timestamp(25)).unwrap(), 2);
        assert_eq!(store.load_since(Timestamp(0)).unwrap().len(), 1);
    }
}
