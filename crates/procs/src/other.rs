//! macOS and Windows: one `sysinfo` refresh per query, limited to the PID asked for.

use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

pub struct RawEntry {
    pub name: String,
    pub parent: Option<u32>,
}

fn with_process<T>(pid: u32, kind: ProcessRefreshKind, read: impl FnOnce(&sysinfo::Process) -> T) -> Option<T> {
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, kind);
    system.process(pid).map(read)
}

pub fn entry(pid: u32) -> Option<RawEntry> {
    with_process(pid, ProcessRefreshKind::nothing(), |p| RawEntry {
        name: p.name().to_string_lossy().into_owned(),
        parent: p.parent().map(|p| p.as_u32()),
    })
}

pub fn is_alive(pid: u32) -> bool {
    with_process(pid, ProcessRefreshKind::nothing(), |p| p.status() != ProcessStatus::Zombie).unwrap_or(false)
}

pub fn args(pid: u32) -> Option<Vec<String>> {
    with_process(pid, ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always), |p| {
        p.cmd().iter().map(|a| a.to_string_lossy().into_owned()).collect()
    })
}

/// One snapshot of every process: on Windows any query lists them all anyway, so a whole chain costs
/// the same as one PID.
pub struct Table(System);

impl Table {
    pub fn load() -> Self {
        let mut system = System::new();
        system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        Self(system)
    }

    pub fn entry(&self, pid: u32) -> Option<RawEntry> {
        self.0.process(Pid::from_u32(pid)).map(|p| RawEntry {
            name: p.name().to_string_lossy().into_owned(),
            parent: p.parent().map(|p| p.as_u32()),
        })
    }
}
