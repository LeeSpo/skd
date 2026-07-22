use anyhow::{anyhow, Result};
use russh::keys::{HashAlg, PublicKey, PublicKeyBase64};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static KNOWN_HOSTS_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
static TEST_KNOWN_HOSTS_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub const UNKNOWN_HOST_KEY_PREFIX: &str = "UNKNOWN_HOST_KEY:";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum VerifyResult {
    Known,
    Unknown {
        fingerprint: String,
        key_type: String,
    },
    Mismatch {
        fingerprint: String,
        expected_fingerprint: String,
    },
}

pub fn known_hosts_path() -> Result<PathBuf> {
    #[cfg(test)]
    if let Ok(guard) = TEST_KNOWN_HOSTS_PATH.lock() {
        if let Some(path) = guard.as_ref() {
            return Ok(path.clone());
        }
    }
    let base =
        dirs::data_local_dir().ok_or_else(|| anyhow!("Could not resolve app data directory"))?;
    Ok(base.join("com.spo.skd").join("known_hosts"))
}

fn host_port_label(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

fn parse_line(line: &str) -> Option<(String, String, String)> {
    let line = line.split('#').next()?.trim();
    if line.is_empty() {
        return None;
    }
    let mut parts = line.split_whitespace();
    let hostnames = parts.next()?;
    let key_type = parts.next()?;
    let key_data = parts.next()?;
    Some((
        hostnames.to_string(),
        key_type.to_string(),
        key_data.to_string(),
    ))
}

fn read_entries() -> Result<Vec<(String, String, String)>> {
    let path = known_hosts_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)?;
    Ok(content.lines().filter_map(parse_line).collect())
}

fn write_entries(entries: &[(String, String, String)]) -> Result<()> {
    let path = known_hosts_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)?;
    for (host, key_type, key_data) in entries {
        writeln!(file, "{host} {key_type} {key_data}")?;
    }
    Ok(())
}

pub fn verify_host_key(host: &str, port: u16, public_key: &PublicKey) -> Result<VerifyResult> {
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|_| anyhow!("Lock poisoned"))?;
    let label = host_port_label(host, port);
    let key_type = public_key.algorithm().as_str().to_string();
    let key_data = public_key.public_key_base64();
    let fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();

    let entries = read_entries()?;
    for (hostnames, stored_type, stored_data) in &entries {
        if !hostnames.split(',').any(|h| h == label) {
            continue;
        }
        if stored_type == &key_type && stored_data == &key_data {
            return Ok(VerifyResult::Known);
        }
        let expected_fp = format!("{stored_type} {stored_data}");
        return Ok(VerifyResult::Mismatch {
            fingerprint,
            expected_fingerprint: expected_fp,
        });
    }

    Ok(VerifyResult::Unknown {
        fingerprint,
        key_type,
    })
}

/// Store a trusted host key using the exact algorithm name and base64 blob
/// reported by the server (matches `verify_host_key` comparison fields).
pub fn trust_host_key_entry(host: &str, port: u16, key_type: &str, key_data: &str) -> Result<()> {
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|_| anyhow!("Lock poisoned"))?;
    let label = host_port_label(host, port);

    let mut entries = read_entries()?;
    entries.retain(|(hostnames, _, _)| !hostnames.split(',').any(|h| h == label));
    entries.push((label, key_type.to_string(), key_data.to_string()));
    write_entries(&entries)
}

pub fn format_unknown_host_error(host: &str, port: u16, public_key: &PublicKey) -> String {
    format!(
        "{UNKNOWN_HOST_KEY_PREFIX}{}",
        serde_json::json!({
            "host": host,
            "port": port,
            "fingerprint": public_key.fingerprint(HashAlg::Sha256).to_string(),
            "keyType": public_key.algorithm().as_str(),
            "keyData": public_key.public_key_base64(),
        })
    )
}

pub fn format_mismatch_host_error(host: &str, port: u16, result: &VerifyResult) -> String {
    match result {
        VerifyResult::Mismatch {
            fingerprint,
            expected_fingerprint,
        } => format!(
            "Host key mismatch for {host}:{port}. Server fingerprint: {fingerprint}. Expected: {expected_fingerprint}."
        ),
        _ => format!("Host key verification failed for {host}:{port}."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::{key::safe_rng, Algorithm, PrivateKey};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);
    static TEST_SERIAL: Mutex<()> = Mutex::new(());

    fn temp_known_hosts() -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("skd-known-hosts-test-{n}"))
    }

    fn with_temp_store<F: FnOnce()>(f: F) {
        let _serial = TEST_SERIAL.lock().expect("known_hosts test serial lock");
        let path = temp_known_hosts();
        let _ = fs::remove_file(&path);
        {
            let mut guard = TEST_KNOWN_HOSTS_PATH.lock().expect("test path lock");
            *guard = Some(path.clone());
        }
        f();
        let _ = fs::remove_file(&path);
        let mut guard = TEST_KNOWN_HOSTS_PATH.lock().expect("test path lock");
        *guard = None;
    }

    #[test]
    fn trust_and_verify_round_trip() {
        with_temp_store(|| {
            let keypair = PrivateKey::random(&mut safe_rng(), Algorithm::Ed25519).unwrap();
            let public = keypair.public_key().clone();
            trust_host_key_entry(
                "example.com",
                22,
                public.algorithm().as_str(),
                &public.public_key_base64(),
            )
            .unwrap();
            let result = verify_host_key("example.com", 22, &public).unwrap();
            assert_eq!(result, VerifyResult::Known);
        });
    }

    #[test]
    fn unknown_host_returns_unknown() {
        with_temp_store(|| {
            let keypair = PrivateKey::random(&mut safe_rng(), Algorithm::Ed25519).unwrap();
            let public = keypair.public_key().clone();
            let result = verify_host_key("new.host", 22, &public).unwrap();
            assert!(matches!(result, VerifyResult::Unknown { .. }));
        });
    }

    #[test]
    fn trust_entry_round_trip_from_key_parts() {
        with_temp_store(|| {
            let keypair = PrivateKey::random(&mut safe_rng(), Algorithm::Ed25519).unwrap();
            let public = keypair.public_key().clone();
            let key_type = public.algorithm().as_str().to_string();
            let key_data = public.public_key_base64();

            trust_host_key_entry("10.0.0.1", 22, &key_type, &key_data).unwrap();
            let result = verify_host_key("10.0.0.1", 22, &public).unwrap();
            assert_eq!(result, VerifyResult::Known);
        });
    }
}
