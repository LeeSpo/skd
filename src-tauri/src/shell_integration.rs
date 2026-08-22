use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

const BASH_INIT_FILE: &str = "bash-init.sh";
const ZSH_INTEGRATION_FILE: &str = "skd-zsh-integration.zsh";

const BASH_INIT_SCRIPT: &str = r#"# skd session-scoped shell integration
SKD_SHELL_INTEGRATION_ACTIVE=1

# This shell is launched through --init-file, so reproduce bash's login-file
# order before adding the prompt hook.
if [ -r /etc/profile ]; then
  . /etc/profile
fi
if [ -r "$SKD_USER_HOME/.bash_profile" ]; then
  . "$SKD_USER_HOME/.bash_profile"
elif [ -r "$SKD_USER_HOME/.bash_login" ]; then
  . "$SKD_USER_HOME/.bash_login"
elif [ -r "$SKD_USER_HOME/.profile" ]; then
  . "$SKD_USER_HOME/.profile"
fi

__skd_escape_cwd() {
  local LC_ALL=C value="$1" out="" byte token code i
  for ((i = 0; i < ${#value}; i++)); do
    byte="${value:i:1}"
    printf -v code '%d' "'$byte"
    if ((code >= 0 && code < 32)); then
      printf -v token '\\x%02x' "$code"
    elif [ "$byte" = '\' ]; then
      token='\\'
    elif [ "$byte" = ';' ]; then
      token='\x3b'
    else
      token="$byte"
    fi
    out+="$token"
  done
  printf '%s' "$out"
}

__skd_precmd_begin() {
  __skd_last_status=$?
  __skd_in_prompt=1
}

__skd_precmd_end() {
  printf '\033]633;D;%s\007' "${__skd_last_status:-0}"
  printf '\033]633;P;Cwd=%s\007' "$(__skd_escape_cwd "$PWD")"
  printf '\033]633;A\007'
  __skd_in_prompt=0
  __skd_expect_cmd=1
  return "${__skd_last_status:-0}"
}

__skd_preexec() {
  [ "${__skd_in_prompt:-0}" = 1 ] && return
  [ "${__skd_expect_cmd:-0}" = 1 ] || return
  [ -n "${COMP_LINE-}" ] && return
  case "${BASH_COMMAND-}" in
    ''|__skd_*) return ;;
  esac
  __skd_expect_cmd=0
  printf '\033]633;C\007'
}

__skd_debug_hook() {
  __skd_preexec
  if [ -n "${__skd_original_debug_trap-}" ]; then
    eval "${__skd_original_debug_trap}"
  fi
}

if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then
  case " ${PROMPT_COMMAND[*]} " in
    *" __skd_precmd_begin "*) ;;
    *) PROMPT_COMMAND=(__skd_precmd_begin "${PROMPT_COMMAND[@]}" __skd_precmd_end) ;;
  esac
else
  case ";${PROMPT_COMMAND:-};" in
    *';__skd_precmd_begin;'*) ;;
    *) PROMPT_COMMAND="__skd_precmd_begin${PROMPT_COMMAND:+;$PROMPT_COMMAND};__skd_precmd_end" ;;
  esac
fi

__skd_original_debug_trap=
if [[ "$(trap -p DEBUG 2>/dev/null)" =~ trap\ --\ \'(.*)\'\ DEBUG ]]; then
  __skd_original_debug_trap="${BASH_REMATCH[1]}"
fi
trap '__skd_debug_hook' DEBUG

rm -rf -- "$SKD_INTEGRATION_DIR"
unset SKD_INTEGRATION_DIR SKD_USER_HOME
"#;

const ZSH_INTEGRATION_SCRIPT: &str = r#"# skd session-scoped shell integration
typeset -gx SKD_SHELL_INTEGRATION_ACTIVE=1

__skd_escape_cwd() {
  emulate -L zsh
  local LC_ALL=C value="$1" out="" byte token code i
  for ((i = 1; i <= ${#value}; i++)); do
    byte="${value[i]}"
    printf -v code '%d' "'$byte"
    if ((code >= 0 && code < 32)); then
      printf -v token '\\x%02x' "$code"
    elif [[ "$byte" == '\' ]]; then
      token='\\'
    elif [[ "$byte" == ';' ]]; then
      token='\x3b'
    else
      token="$byte"
    fi
    out+="$token"
  done
  print -rn -- "$out"
}

__skd_preexec() {
  emulate -L zsh
  if [[ -z "${1//[$' \t']}" ]]; then
    return
  fi
  builtin printf '\033]633;C\007'
}

__skd_precmd() {
  local last_status=$?
  builtin printf '\033]633;D;%s\007' "$last_status"
  builtin printf '\033]633;P;Cwd=%s\007' "$(__skd_escape_cwd "$PWD")"
  builtin printf '\033]633;A\007'
  return "$last_status"
}

autoload -Uz add-zsh-hook
add-zsh-hook -d precmd __skd_report_cwd 2>/dev/null
add-zsh-hook -d precmd __skd_precmd 2>/dev/null
add-zsh-hook -d preexec __skd_preexec 2>/dev/null
add-zsh-hook precmd __skd_precmd
add-zsh-hook preexec __skd_preexec
"#;

const ZSH_ENV_WRAPPER: &str = r#"SKD_INTEGRATION_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$SKD_USER_ZDOTDIR"
if [[ -o RCS && -r "$ZDOTDIR/.zshenv" ]]; then
  source "$ZDOTDIR/.zshenv"
fi
SKD_USER_ZDOTDIR="${ZDOTDIR:-$SKD_USER_HOME}"
# Remember a user-set HISTFILE that is not inside the integration dir.
# macOS /etc/zshrc later overwrites HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history
# while ZDOTDIR still points at the temp integration directory.
if [[ -n "${HISTFILE:-}" && "$HISTFILE" != "$SKD_INTEGRATION_ZDOTDIR/"* && "$HISTFILE" != "$SKD_INTEGRATION_DIR/"* ]]; then
  SKD_USER_HISTFILE="$HISTFILE"
fi
ZDOTDIR="$SKD_INTEGRATION_ZDOTDIR"
source "$SKD_INTEGRATION_ZDOTDIR/skd-zsh-integration.zsh"
"#;

const ZSH_PROFILE_WRAPPER: &str = r#"ZDOTDIR="$SKD_USER_ZDOTDIR"
if [[ -o RCS && -r "$ZDOTDIR/.zprofile" ]]; then
  source "$ZDOTDIR/.zprofile"
fi
SKD_USER_ZDOTDIR="${ZDOTDIR:-$SKD_USER_HOME}"
ZDOTDIR="$SKD_INTEGRATION_ZDOTDIR"
"#;

const ZSH_RC_WRAPPER: &str = r#"ZDOTDIR="$SKD_USER_ZDOTDIR"
# /etc/zshrc on macOS sets HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history while ZDOTDIR
# is still the integration temp dir. Restore the user's history file before
# ~/.zshrc so plugins and Up/Down (up-line-or-search) see host-terminal commands.
if [[ -n "${SKD_USER_HISTFILE:-}" ]]; then
  HISTFILE="$SKD_USER_HISTFILE"
else
  HISTFILE="${SKD_USER_ZDOTDIR:-$SKD_USER_HOME}/.zsh_history"
fi
if [[ -o RCS && -r "$ZDOTDIR/.zshrc" ]]; then
  source "$ZDOTDIR/.zshrc"
fi
# User/plugin code may have reset HISTFILE from ZDOTDIR. Clamp if it still
# points at the integration directory.
if [[ "${HISTFILE:-}" == "$SKD_INTEGRATION_ZDOTDIR/"* || "${HISTFILE:-}" == "$SKD_INTEGRATION_DIR/"* ]]; then
  HISTFILE="${SKD_USER_HISTFILE:-${SKD_USER_ZDOTDIR:-$SKD_USER_HOME}/.zsh_history}"
fi
SKD_USER_ZDOTDIR="${ZDOTDIR:-$SKD_USER_HOME}"
ZDOTDIR="$SKD_INTEGRATION_ZDOTDIR"
source "$SKD_INTEGRATION_ZDOTDIR/skd-zsh-integration.zsh"
"#;

const ZSH_LOGIN_WRAPPER: &str = r#"ZDOTDIR="$SKD_USER_ZDOTDIR"
if [[ -o RCS && -r "$ZDOTDIR/.zlogin" ]]; then
  source "$ZDOTDIR/.zlogin"
fi
source "$SKD_INTEGRATION_ZDOTDIR/skd-zsh-integration.zsh"
ZDOTDIR="$SKD_USER_ZDOTDIR"
rm -rf -- "$SKD_INTEGRATION_ZDOTDIR"
unset SKD_INTEGRATION_ZDOTDIR SKD_INTEGRATION_DIR SKD_USER_HOME SKD_USER_ZDOTDIR SKD_USER_HISTFILE
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Bash,
    Zsh,
}

impl ShellKind {
    pub fn detect(shell_path: &str) -> Option<Self> {
        if shell_path.is_empty() || shell_path.chars().any(char::is_control) {
            return None;
        }
        let path = Path::new(shell_path);
        if !path.is_absolute() {
            return None;
        }
        match path.file_name()?.to_str()? {
            "bash" => Some(Self::Bash),
            "zsh" => Some(Self::Zsh),
            _ => None,
        }
    }
}

pub struct LocalShellLaunch {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub temp_dir: TempDir,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteShellInfo {
    pub kind: ShellKind,
    pub shell_path: String,
    pub home: String,
    pub zdotdir: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteShellLaunch {
    pub command: String,
    pub temp_dir: String,
}

pub fn prepare_local_shell(shell_path: &str) -> Result<Option<LocalShellLaunch>> {
    let Some(kind) = ShellKind::detect(shell_path) else {
        return Ok(None);
    };
    let home = dirs::home_dir().ok_or_else(|| anyhow!("home directory is unavailable"))?;
    let temp_dir = tempfile::Builder::new()
        .prefix("skd-shell.")
        .tempdir()
        .context("failed to create shell-integration directory")?;
    write_startup_files(temp_dir.path(), kind)?;

    let integration_dir = temp_dir.path().to_string_lossy().to_string();
    let user_home = home.to_string_lossy().to_string();
    let mut env = vec![
        ("TERM_PROGRAM".to_string(), "skd".to_string()),
        ("SKD_INTEGRATION_DIR".to_string(), integration_dir.clone()),
        ("SKD_USER_HOME".to_string(), user_home.clone()),
    ];
    let args = match kind {
        ShellKind::Bash => vec![
            "--noprofile".to_string(),
            "--init-file".to_string(),
            temp_dir
                .path()
                .join(BASH_INIT_FILE)
                .to_string_lossy()
                .to_string(),
            "-i".to_string(),
        ],
        ShellKind::Zsh => {
            let user_zdotdir = std::env::var("ZDOTDIR").unwrap_or(user_home);
            env.push(("SKD_USER_ZDOTDIR".to_string(), user_zdotdir));
            env.push(("ZDOTDIR".to_string(), integration_dir));
            vec!["-l".to_string()]
        }
    };

    Ok(Some(LocalShellLaunch {
        args,
        env,
        temp_dir,
    }))
}

const REMOTE_PROBE_START: &str = "__SKD_SHELL_PROBE__";
const REMOTE_PROBE_END: &str = "__SKD_SHELL_PROBE_END__";
const REMOTE_DIR_START: &str = "__SKD_SHELL_DIR__";
const REMOTE_DIR_END: &str = "__SKD_SHELL_DIR_END__";

pub const REMOTE_SHELL_PROBE_COMMAND: &str = "printf '\\n__SKD_SHELL_PROBE__%s\\037%s\\037%s__SKD_SHELL_PROBE_END__\\n' \"${SHELL-}\" \"${HOME-}\" \"${ZDOTDIR-}\"";

pub fn parse_remote_shell_probe(output: &str) -> Option<RemoteShellInfo> {
    let payload = marked_value(output, REMOTE_PROBE_START, REMOTE_PROBE_END)?;
    let mut fields = payload.split('\x1f');
    let shell_path = fields.next()?.to_string();
    let home = fields.next()?.to_string();
    let zdotdir = fields.next().unwrap_or_default().to_string();
    if fields.next().is_some()
        || home.is_empty()
        || !Path::new(&home).is_absolute()
        || home.chars().any(char::is_control)
        || zdotdir.chars().any(char::is_control)
    {
        return None;
    }
    let kind = ShellKind::detect(&shell_path)?;
    let zdotdir = if zdotdir.is_empty() {
        home.clone()
    } else {
        zdotdir
    };
    if !Path::new(&zdotdir).is_absolute() {
        return None;
    }
    Some(RemoteShellInfo {
        kind,
        shell_path,
        home,
        zdotdir,
    })
}

pub fn remote_prepare_command(kind: ShellKind) -> String {
    let files = startup_files(kind);
    let mut command = String::from(
        "set -eu\numask 077\nskd_dir=$(mktemp -d \"${TMPDIR:-/tmp}/skd-shell.XXXXXX\")\ntrap 'rm -rf -- \"$skd_dir\"' EXIT HUP INT TERM\n",
    );
    for (index, (name, contents)) in files.iter().enumerate() {
        let marker = format!("__SKD_SHELL_FILE_{index}__");
        command.push_str(&format!(
            "cat >\"$skd_dir/{name}\" <<'{marker}'\n{contents}{marker}\n"
        ));
    }
    command.push_str(
        "chmod 600 \"$skd_dir\"/*\ntrap - EXIT HUP INT TERM\nprintf '\\n__SKD_SHELL_DIR__%s__SKD_SHELL_DIR_END__\\n' \"$skd_dir\"\n",
    );
    command
}

pub fn parse_remote_temp_dir(output: &str) -> Option<&str> {
    let path = marked_value(output, REMOTE_DIR_START, REMOTE_DIR_END)?;
    is_safe_remote_temp_dir(path).then_some(path)
}

pub fn build_remote_launch(info: &RemoteShellInfo, temp_dir: &str) -> Option<RemoteShellLaunch> {
    if !is_safe_remote_temp_dir(temp_dir) {
        return None;
    }
    let shell = shell_quote(&info.shell_path);
    let home = shell_quote(&info.home);
    let zdotdir = shell_quote(&info.zdotdir);
    let dir = shell_quote(temp_dir);
    let command = match info.kind {
        ShellKind::Bash => format!(
            "SKD_USER_HOME={home} SKD_INTEGRATION_DIR={dir} TERM_PROGRAM=skd exec {shell} --noprofile --init-file {dir}/{BASH_INIT_FILE} -i"
        ),
        ShellKind::Zsh => format!(
            "SKD_USER_HOME={home} SKD_USER_ZDOTDIR={zdotdir} SKD_INTEGRATION_DIR={dir} ZDOTDIR={dir} TERM_PROGRAM=skd exec {shell} -l"
        ),
    };
    Some(RemoteShellLaunch {
        command,
        temp_dir: temp_dir.to_string(),
    })
}

pub fn remote_cleanup_command(temp_dir: &str) -> Option<String> {
    is_safe_remote_temp_dir(temp_dir).then(|| format!("rm -rf -- {}", shell_quote(temp_dir)))
}

fn startup_files(kind: ShellKind) -> Vec<(&'static str, &'static str)> {
    match kind {
        ShellKind::Bash => vec![(BASH_INIT_FILE, BASH_INIT_SCRIPT)],
        ShellKind::Zsh => vec![
            (ZSH_INTEGRATION_FILE, ZSH_INTEGRATION_SCRIPT),
            (".zshenv", ZSH_ENV_WRAPPER),
            (".zprofile", ZSH_PROFILE_WRAPPER),
            (".zshrc", ZSH_RC_WRAPPER),
            (".zlogin", ZSH_LOGIN_WRAPPER),
        ],
    }
}

fn write_startup_files(dir: &Path, kind: ShellKind) -> Result<()> {
    for (name, contents) in startup_files(kind) {
        let path = dir.join(name);
        fs::write(&path, contents)
            .with_context(|| format!("failed to write {}", path.display()))?;
        set_owner_only_permissions(&path)?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_owner_only_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

fn is_safe_remote_temp_dir(value: &str) -> bool {
    if value.is_empty() || value.chars().any(char::is_control) {
        return false;
    }
    let path = PathBuf::from(value);
    path.is_absolute()
        && !path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("skd-shell.") && name.len() > "skd-shell.".len())
}

fn marked_value<'a>(output: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let start_index = output.rfind(start)? + start.len();
    let remainder = &output[start_index..];
    let end_index = remainder.find(end)?;
    Some(&remainder[..end_index])
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;

    #[test]
    fn detects_only_absolute_bash_and_zsh_paths() {
        assert_eq!(ShellKind::detect("/bin/bash"), Some(ShellKind::Bash));
        assert_eq!(
            ShellKind::detect("/opt/homebrew/bin/zsh"),
            Some(ShellKind::Zsh)
        );
        assert_eq!(ShellKind::detect("bash"), None);
        assert_eq!(ShellKind::detect("/bin/fish"), None);
    }

    #[test]
    fn parses_remote_probe_and_rejects_unsafe_values() {
        assert_eq!(
            parse_remote_shell_probe(
                "startup noise\n__SKD_SHELL_PROBE__/bin/bash\x1f/home/alice\x1f__SKD_SHELL_PROBE_END__\n"
            ),
            Some(RemoteShellInfo {
                kind: ShellKind::Bash,
                shell_path: "/bin/bash".into(),
                home: "/home/alice".into(),
                zdotdir: "/home/alice".into(),
            })
        );
        assert!(parse_remote_shell_probe(
            "__SKD_SHELL_PROBE__bash\x1f/home/alice\x1f__SKD_SHELL_PROBE_END__"
        )
        .is_none());
        assert!(parse_remote_shell_probe(
            "__SKD_SHELL_PROBE__/bin/zsh\x1frelative\x1f__SKD_SHELL_PROBE_END__"
        )
        .is_none());
    }

    #[test]
    fn local_files_are_private_and_launch_does_not_edit_user_rc_files() {
        let launch = prepare_local_shell("/bin/bash").unwrap().unwrap();
        let init = launch.temp_dir.path().join(BASH_INIT_FILE);
        assert!(init.exists());
        assert_eq!(
            fs::metadata(init).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(launch.args.iter().any(|arg| arg == "--init-file"));
    }

    #[test]
    fn remote_launch_quotes_paths_and_cleanup_requires_generated_name() {
        let info = RemoteShellInfo {
            kind: ShellKind::Zsh,
            shell_path: "/bin/zsh".into(),
            home: "/home/o'connor".into(),
            zdotdir: "/home/o'connor/.config/zsh".into(),
        };
        let launch = build_remote_launch(&info, "/tmp/skd-shell.ABC123").unwrap();
        assert!(launch.command.contains("'/home/o'\\''connor'"));
        assert!(launch.command.contains("ZDOTDIR='/tmp/skd-shell.ABC123'"));
        assert_eq!(
            remote_cleanup_command("/tmp/skd-shell.ABC123").as_deref(),
            Some("rm -rf -- '/tmp/skd-shell.ABC123'")
        );
        assert!(remote_cleanup_command("/tmp/unrelated").is_none());
        assert!(remote_cleanup_command("/tmp/skd-shell.x/../other").is_none());
    }

    #[test]
    fn generated_remote_script_uses_private_permissions_and_cwd_protocol() {
        let command = remote_prepare_command(ShellKind::Bash);
        assert!(command.contains("umask 077"));
        assert!(command.contains("chmod 600"));
        assert!(command.contains("633;P;Cwd="));
        assert!(command.contains("633;C"));
        assert!(command.contains("633;D;"));
        assert!(command.contains("633;A"));
        assert!(!command.contains(".bashrc <<"));
    }

    #[test]
    fn remote_prepare_script_creates_private_startup_files() {
        for interpreter in ["/bin/bash", "/bin/zsh"] {
            if !Path::new(interpreter).exists() {
                continue;
            }
            let output = Command::new(interpreter)
                .arg("-c")
                .arg(remote_prepare_command(ShellKind::Zsh))
                .output()
                .expect("failed to run remote preparation script");
            assert!(
                output.status.success(),
                "{interpreter} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let stdout = String::from_utf8(output.stdout).unwrap();
            let dir = parse_remote_temp_dir(&stdout).unwrap().to_string();
            let path = Path::new(&dir);
            assert!(path.join(ZSH_INTEGRATION_FILE).exists());
            assert!(path.join(".zshrc").exists());
            assert_eq!(
                fs::metadata(path.join(".zshrc"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            fs::remove_dir_all(path).unwrap();
        }
    }

    #[test]
    fn zsh_histfile_uses_user_history_not_integration_dir() {
        if !Path::new("/bin/zsh").exists() {
            return;
        }
        let fake_home = tempfile::tempdir().expect("fake home");
        let user_zdot = fake_home.path();
        fs::write(user_zdot.join(".zshrc"), "").unwrap();
        fs::write(user_zdot.join(".zsh_history"), "echo from-host-history\n").unwrap();

        let integration = tempfile::Builder::new()
            .prefix("skd-shell.")
            .tempdir()
            .unwrap();
        write_startup_files(integration.path(), ShellKind::Zsh).unwrap();

        let output = Command::new("/bin/zsh")
            .args([
                "-lic",
                r#"print -r -- "$HISTFILE"; print -r -- "__FC__"; fc -R "$HISTFILE"; fc -l 1 20"#,
            ])
            .env("HOME", fake_home.path())
            .env("USER", "skd-test")
            .env("TERM", "xterm-256color")
            .env("LANG", "C")
            .env("LC_ALL", "C")
            .env("ZDOTDIR", integration.path())
            .env("SKD_INTEGRATION_DIR", integration.path())
            .env("SKD_USER_HOME", fake_home.path())
            .env("SKD_USER_ZDOTDIR", user_zdot)
            .output()
            .expect("zsh -lic");

        let stdout = String::from_utf8_lossy(&output.stdout);
        let histfile = format!("{}/.zsh_history", user_zdot.display());
        assert!(
            stdout.contains(&histfile),
            "HISTFILE should be the user file, got: {stdout:?}\nstderr: {:?}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            !stdout.contains("skd-shell."),
            "HISTFILE must not point at the integration dir, got: {stdout:?}"
        );
        assert!(
            stdout.contains("from-host-history"),
            "fc should list the host history entry, got: {stdout:?}\nstderr: {:?}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn zsh_histfile_preserves_custom_histfile_from_zshenv() {
        if !Path::new("/bin/zsh").exists() {
            return;
        }
        let fake_home = tempfile::tempdir().expect("fake home");
        let user_zdot = fake_home.path();
        let custom = user_zdot.join(".custom_history");
        fs::write(
            user_zdot.join(".zshenv"),
            format!("HISTFILE={}\n", custom.display()),
        )
        .unwrap();
        fs::write(user_zdot.join(".zshrc"), "").unwrap();
        fs::write(&custom, "echo from-custom-histfile\n").unwrap();

        let integration = tempfile::Builder::new()
            .prefix("skd-shell.")
            .tempdir()
            .unwrap();
        write_startup_files(integration.path(), ShellKind::Zsh).unwrap();

        let output = Command::new("/bin/zsh")
            .args(["-lic", r#"print -r -- "$HISTFILE""#])
            .env("HOME", fake_home.path())
            .env("USER", "skd-test")
            .env("TERM", "xterm-256color")
            .env("LANG", "C")
            .env("LC_ALL", "C")
            .env("ZDOTDIR", integration.path())
            .env("SKD_INTEGRATION_DIR", integration.path())
            .env("SKD_USER_HOME", fake_home.path())
            .env("SKD_USER_ZDOTDIR", user_zdot)
            .output()
            .expect("zsh -lic");

        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains(&custom.display().to_string()),
            "custom HISTFILE from .zshenv must survive /etc/zshrc, got: {stdout:?}\nstderr: {:?}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
