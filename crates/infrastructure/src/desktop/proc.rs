/// `pid` and its ancestors, nearest first (stopping before init).
pub fn ancestry(pid: u32) -> Vec<u32> {
    awr_procs::ancestry(pid, 16).into_iter().map(|(pid, _)| pid).collect()
}
