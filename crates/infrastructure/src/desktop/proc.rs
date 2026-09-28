/// `pid` and its ancestors, nearest first (stopping before init).
pub fn ancestry(pid: u32) -> Vec<u32> {
    let mut chain = Vec::new();
    let mut current = pid;
    while current > 1 && chain.len() < 16 {
        chain.push(current);
        match parent(current) {
            Some(ppid) => current = ppid,
            None => break,
        }
    }
    chain
}

fn parent(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let close = stat.rfind(')')?;
    stat[close + 1..].split_whitespace().nth(1)?.parse().ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn starts_with_the_pid_and_climbs_to_the_parent() {
        let chain = super::ancestry(std::process::id());
        assert_eq!(chain[0], std::process::id());
        assert_eq!(chain.get(1).copied(), Some(std::os::unix::process::parent_id()));
    }
}
