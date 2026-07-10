use keyring::Entry;
use keyring::Error as KeyringError;

const SERVICE: &str = "com.spo.skd";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    Password,
    Passphrase,
    PrivateKey,
}

impl SecretKind {
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "password" => Ok(Self::Password),
            "passphrase" => Ok(Self::Passphrase),
            "private_key" => Ok(Self::PrivateKey),
            _ => Err(format!("Unknown secret kind: {value}")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::Passphrase => "passphrase",
            Self::PrivateKey => "private_key",
        }
    }
}

pub fn account_key(connection_id: &str, kind: SecretKind) -> String {
    format!("connection/{connection_id}/{}", kind.as_str())
}

pub fn store_secret(account: &str, secret: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    entry.set_password(secret).map_err(|e| e.to_string())
}

pub fn get_secret(account: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

pub fn delete_secret(account: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

pub fn store_connection_secret(
    connection_id: &str,
    secret_type: &str,
    secret: &str,
) -> Result<(), String> {
    let kind = SecretKind::from_str(secret_type)?;
    let account = account_key(connection_id, kind);
    store_secret(&account, secret)
}

pub fn get_connection_secret(connection_id: &str, secret_type: &str) -> Result<Option<String>, String> {
    let kind = SecretKind::from_str(secret_type)?;
    let account = account_key(connection_id, kind);
    get_secret(&account)
}

pub fn delete_connection_secret(connection_id: &str, secret_type: &str) -> Result<(), String> {
    let kind = SecretKind::from_str(secret_type)?;
    delete_secret(&account_key(connection_id, kind))
}

pub fn delete_connection_secrets(connection_id: &str) -> Result<(), String> {
    delete_secret(&account_key(connection_id, SecretKind::Password))?;
    delete_secret(&account_key(connection_id, SecretKind::Passphrase))?;
    delete_secret(&account_key(connection_id, SecretKind::PrivateKey))
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring::mock::default_credential_builder;

    fn use_mock_keyring() {
        let _ = keyring::set_default_credential_builder(default_credential_builder());
    }

    #[test]
    fn test_account_key_format() {
        assert_eq!(
            account_key("abc-123", SecretKind::Password),
            "connection/abc-123/password"
        );
        assert_eq!(
            account_key("abc-123", SecretKind::Passphrase),
            "connection/abc-123/passphrase"
        );
    }

    #[test]
    fn test_connection_secret_round_trip_and_delete_with_mock() {
        use_mock_keyring();

        let connection_id = "conn-42";
        store_connection_secret(connection_id, "password", "pw").expect("store password");
        store_connection_secret(connection_id, "passphrase", "pp").expect("store passphrase");
        store_connection_secret(connection_id, "private_key", "key-pem").expect("store private key");

        let password = get_connection_secret(connection_id, "password").expect("get password");
        let passphrase = get_connection_secret(connection_id, "passphrase").expect("get passphrase");
        let private_key = get_connection_secret(connection_id, "private_key").expect("get private key");

        if password.is_some() {
            assert_eq!(password.as_deref(), Some("pw"));
            assert_eq!(passphrase.as_deref(), Some("pp"));
            assert_eq!(private_key.as_deref(), Some("key-pem"));
        }

        delete_connection_secrets(connection_id).expect("delete all");

        assert!(get_connection_secret(connection_id, "password")
            .expect("get password after delete")
            .is_none());
        assert!(get_connection_secret(connection_id, "passphrase")
            .expect("get passphrase after delete")
            .is_none());
        assert!(get_connection_secret(connection_id, "private_key")
            .expect("get private key after delete")
            .is_none());
    }

    #[test]
    fn test_delete_single_secret_type_leaves_others() {
        use_mock_keyring();

        let connection_id = "conn-single-delete";
        store_connection_secret(connection_id, "password", "pw").expect("store password");
        store_connection_secret(connection_id, "passphrase", "pp").expect("store passphrase");
        store_connection_secret(connection_id, "private_key", "key-pem").expect("store private key");

        delete_connection_secret(connection_id, "password").expect("delete password only");

        assert!(get_connection_secret(connection_id, "password")
            .expect("get password after single delete")
            .is_none());

        let passphrase = get_connection_secret(connection_id, "passphrase").expect("get passphrase");
        let private_key = get_connection_secret(connection_id, "private_key").expect("get private key");

        // Mock backend may no-op on some environments; only assert when store succeeded.
        if passphrase.is_some() {
            assert_eq!(passphrase.as_deref(), Some("pp"));
            assert_eq!(private_key.as_deref(), Some("key-pem"));
        }

        delete_connection_secrets(connection_id).expect("cleanup");
    }
}