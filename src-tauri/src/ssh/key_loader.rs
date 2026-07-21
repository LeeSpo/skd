use anyhow::Result;
use russh_keys::{decode_secret_key, key::KeyPair};
use std::path::Path;

/// Expand a leading `~` to the user's home directory.
pub fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            let home_str = home.to_string_lossy();
            return path.replacen('~', &home_str, 1);
        }
    }
    path.to_string()
}

/// Normalise PEM / OpenSSH key text (CRLF → LF, trim).
pub fn normalise_key_content(content: &str) -> String {
    content.replace("\r\n", "\n").trim().to_string()
}

/// Decode a private key from in-memory PEM / OpenSSH content.
pub fn load_private_key_from_content(content: &str, passphrase: Option<&str>) -> Result<KeyPair> {
    let normalised = normalise_key_content(content);
    decode_secret_key(&normalised, passphrase).map_err(|e| {
        if e.to_string().contains("encrypted") || e.to_string().contains("passphrase") {
            anyhow::anyhow!(
                "Failed to decrypt SSH key. The key may be encrypted. Please provide the correct passphrase."
            )
        } else {
            anyhow::anyhow!(
                "Failed to load SSH private key: {}. Ensure the file is a valid SSH private key (RSA, Ed25519, or ECDSA).",
                e
            )
        }
    })
}

/// Read a private key file from disk and return normalised content.
pub fn read_private_key_file(path: &str) -> Result<String> {
    let expanded = expand_tilde(path);
    if !Path::new(&expanded).exists() {
        return Err(anyhow::anyhow!(
            "SSH key file not found: {path}. Please check the file path and try again."
        ));
    }

    let content = std::fs::read_to_string(&expanded)
        .map_err(|e| anyhow::anyhow!("Failed to read SSH key file {path}: {e}"))?;
    Ok(normalise_key_content(&content))
}

/// Check whether a key file has overly permissive permissions (group/other readable).
#[cfg(unix)]
pub fn key_file_permission_warning(path: &str) -> Option<String> {
    use std::os::unix::fs::PermissionsExt;

    let expanded = expand_tilde(path);
    let metadata = std::fs::metadata(&expanded).ok()?;
    let mode = metadata.permissions().mode();
    if mode & 0o077 != 0 {
        Some(format!(
            "Private key file {path} has permissive permissions ({:o}). Consider running: chmod 600 {path}",
            mode & 0o777
        ))
    } else {
        None
    }
}

#[cfg(not(unix))]
pub fn key_file_permission_warning(_path: &str) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh_keys::{encode_pkcs8_pem, key::KeyPair};
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn sample_pem() -> String {
        let key = KeyPair::generate_ed25519().unwrap();
        let mut pem = Vec::new();
        encode_pkcs8_pem(&key, &mut pem).unwrap();
        String::from_utf8(pem).unwrap()
    }

    #[test]
    fn normalise_strips_crlf() {
        let pem = sample_pem();
        let crlf = pem.replace('\n', "\r\n");
        assert!(load_private_key_from_content(&normalise_key_content(&crlf), None).is_ok());
    }

    #[test]
    fn load_from_content_round_trip() {
        let pem = sample_pem();
        assert!(load_private_key_from_content(&pem, None).is_ok());
    }

    #[test]
    fn read_private_key_file_round_trip() {
        let pem = sample_pem();
        let mut tmp = NamedTempFile::new().unwrap();
        tmp.write_all(pem.as_bytes()).unwrap();
        tmp.flush().unwrap();

        let path = tmp.path().to_string_lossy().to_string();
        let content = read_private_key_file(&path).unwrap();
        assert!(load_private_key_from_content(&content, None).is_ok());
    }

    #[test]
    fn expand_tilde_unix() {
        let expanded = expand_tilde("~/.ssh/id_rsa");
        assert!(!expanded.starts_with('~'));
    }
}
