//! Application-wide FIFO. Cancellation/job handles and lifecycle rules adapted
//! from R-Shell PR #168 (4a63fb8 / 4a0e8a3, MIT); Rust owns the pump so native
//! Finder promises and separate webviews cannot bypass serialization.
use crate::{
    sftp_transfer::{self, TransferProgress},
    ssh::Client,
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

pub const QUEUE_EVENT: &str = "transfer-queue-changed";
type Session = Arc<russh::client::Handle<Client>>;
pub type EventCallback = Arc<dyn Fn(JobEvent) + Send + Sync>;
pub type ProgressCallback = Arc<dyn Fn(TransferProgress) + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Upload,
    Download,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    #[default]
    Browser,
    Directory,
    Sync,
    Editor,
    Finder,
    Legacy,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Transferring,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}
impl Status {
    fn terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub id: Option<String>,
    pub connection_id: String,
    pub connection_name: Option<String>,
    pub file_name: String,
    pub direction: Direction,
    pub source_path: String,
    pub destination_path: String,
    pub total_bytes: Option<u64>,
    #[serde(default)]
    pub source: Source,
    pub owner_id: Option<String>,
}
impl Input {
    pub fn path(
        connection_id: String,
        direction: Direction,
        local: String,
        remote: String,
        source: Source,
    ) -> Self {
        let file_name = remote.rsplit('/').next().unwrap_or(&remote).to_string();
        let (source_path, destination_path) = if direction == Direction::Upload {
            (local, remote)
        } else {
            (remote, local)
        };
        Self {
            id: None,
            connection_id,
            connection_name: None,
            file_name,
            direction,
            source_path,
            destination_path,
            total_bytes: None,
            source,
            owner_id: None,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(flatten)]
    pub input: SerializableInput,
    pub status: Status,
    pub bytes_transferred: u64,
    pub total_bytes: Option<u64>,
    pub progress: u64,
    pub speed: u64,
    pub error: Option<String>,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializableInput {
    pub id: String,
    pub connection_id: String,
    pub connection_name: Option<String>,
    pub file_name: String,
    pub direction: Direction,
    pub source_path: String,
    pub destination_path: String,
    pub source: Source,
    pub owner_id: Option<String>,
    pub owner_window: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: Status,
    pub bytes_transferred: Option<u64>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub items: Vec<Item>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub item: Item,
    pub result: Option<Outcome>,
}
pub struct Ticket {
    pub id: String,
    pub done: oneshot::Receiver<Outcome>,
}
#[derive(Clone)]
struct Binding {
    session: Session,
    cancel: CancellationToken,
}
struct Job {
    request: Input,
    binding: Binding,
    cancel: CancellationToken,
    owner_window: Option<String>,
    events: Option<EventCallback>,
    progress: Option<ProgressCallback>,
    done: oneshot::Sender<Outcome>,
}
#[derive(Default)]
struct State {
    revision: u64,
    items: Vec<Item>,
    pending: VecDeque<String>,
    jobs: HashMap<String, Job>,
    bindings: HashMap<String, Binding>,
    used_ids: HashSet<String>,
    closed_windows: HashSet<String>,
    pumping: bool,
}
pub struct TransferQueue {
    state: Mutex<State>,
    app: Mutex<Option<AppHandle>>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn new_id() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| anyhow!("Could not allocate transfer id: {e}"))?;
    Ok(format!(
        "transfer-{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ))
}
impl Default for TransferQueue {
    fn default() -> Self {
        Self {
            state: Mutex::new(State::default()),
            app: Mutex::new(None),
        }
    }
}
impl TransferQueue {
    pub fn set_app(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }
    pub fn snapshot(&self) -> Snapshot {
        let s = self.state.lock().unwrap();
        Snapshot {
            revision: s.revision,
            items: s.items.clone(),
        }
    }
    fn changed(s: &mut State) -> Snapshot {
        s.revision += 1;
        Snapshot {
            revision: s.revision,
            items: s.items.clone(),
        }
    }
    fn publish(&self, snapshot: Snapshot) {
        if let Some(app) = self.app.lock().unwrap().as_ref() {
            let _ = app.emit(QUEUE_EVENT, snapshot);
        }
    }
    pub fn bind(self: &Arc<Self>, id: String, session: Session) {
        self.unbind(&id);
        let cancel = CancellationToken::new();
        self.state.lock().unwrap().bindings.insert(
            id.clone(),
            Binding {
                session: session.clone(),
                cancel: cancel.clone(),
            },
        );
        let weak_queue = Arc::downgrade(self);
        let weak_session = Arc::downgrade(&session);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = interval.tick() => {
                        let Some(session) = weak_session.upgrade() else { break; };
                        if session.is_closed() {
                            if let Some(queue) = weak_queue.upgrade() {
                                queue.unbind_matching(&id, Some(&session));
                            }
                            break;
                        }
                    }
                }
            }
        });
    }
    pub fn unbind(&self, id: &str) {
        self.unbind_matching(id, None);
    }
    fn unbind_matching(&self, id: &str, expected: Option<&Session>) {
        let ids = {
            let mut s = self.state.lock().unwrap();
            if let Some(expected) = expected {
                if !s
                    .bindings
                    .get(id)
                    .is_some_and(|binding| Arc::ptr_eq(&binding.session, expected))
                {
                    return;
                }
            }
            if let Some(binding) = s.bindings.remove(id) {
                binding.cancel.cancel();
            }
            s.jobs
                .iter()
                .filter(|(_, j)| j.request.connection_id == id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>()
        };
        for id in ids {
            self.cancel(&id);
        }
    }
    pub fn cancel_window(&self, window: &str) {
        let ids = {
            let mut s = self.state.lock().unwrap();
            s.closed_windows.insert(window.to_string());
            s.jobs
                .iter()
                .filter(|(_, j)| {
                    j.request.source == Source::Editor && j.owner_window.as_deref() == Some(window)
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>()
        };
        for id in ids {
            self.cancel(&id);
        }
    }
    pub fn enqueue(
        self: &Arc<Self>,
        inputs: Vec<Input>,
        window: Option<String>,
        events: Option<EventCallback>,
        progress: Option<ProgressCallback>,
    ) -> Result<Vec<Ticket>> {
        let mut inputs = inputs;
        let mut s = self.state.lock().unwrap();
        let mut ids = HashSet::new();
        for input in &mut inputs {
            if input.source == Source::Editor
                && window
                    .as_ref()
                    .is_some_and(|w| s.closed_windows.contains(w))
            {
                return Err(anyhow!(sftp_transfer::CANCEL_ERROR));
            }
            if input.id.is_none() {
                input.id = Some(new_id()?);
            }
            let id = input.id.as_ref().unwrap();
            if id.is_empty() || s.used_ids.contains(id) || !ids.insert(id.clone()) {
                return Err(anyhow!("Duplicate transfer id"));
            }
            if input.source_path.is_empty() || input.destination_path.is_empty() {
                return Err(anyhow!("Transfer paths cannot be empty"));
            }
            let binding = s
                .bindings
                .get(&input.connection_id)
                .ok_or_else(|| anyhow!("SSH/SFTP connection not found"))?;
            if binding.cancel.is_cancelled() || binding.session.is_closed() {
                return Err(anyhow!("SSH/SFTP connection is closed"));
            }
        }
        let mut tickets = Vec::new();
        let mut notifications = Vec::new();
        for request in inputs {
            let id = request.id.as_ref().unwrap().clone();
            let binding = s.bindings[&request.connection_id].clone();
            let (done, receiver) = oneshot::channel();
            let item = Item {
                input: SerializableInput {
                    id: id.clone(),
                    connection_id: request.connection_id.clone(),
                    connection_name: request.connection_name.clone(),
                    file_name: request.file_name.clone(),
                    direction: request.direction,
                    source_path: request.source_path.clone(),
                    destination_path: request.destination_path.clone(),
                    source: request.source,
                    owner_id: request.owner_id.clone(),
                    owner_window: window.clone(),
                },
                status: Status::Queued,
                bytes_transferred: 0,
                total_bytes: request.total_bytes,
                progress: 0,
                speed: 0,
                error: None,
                started_at: None,
                completed_at: None,
            };
            notifications.push(JobEvent {
                item: item.clone(),
                result: None,
            });
            s.items.push(item);
            s.pending.push_back(id.clone());
            s.used_ids.insert(id.clone());
            s.jobs.insert(
                id.clone(),
                Job {
                    cancel: binding.cancel.child_token(),
                    binding,
                    request,
                    owner_window: window.clone(),
                    events: events.clone(),
                    progress: progress.clone(),
                    done,
                },
            );
            tickets.push(Ticket { id, done: receiver });
        }
        let snapshot = Self::changed(&mut s);
        drop(s);
        if let Some(events) = &events {
            for event in notifications {
                events(event);
            }
        }
        self.publish(snapshot);
        self.pump();
        Ok(tickets)
    }
    pub fn cancel(&self, id: &str) -> bool {
        let mut s = self.state.lock().unwrap();
        let Some(index) = s.items.iter().position(|i| i.input.id == id) else {
            return false;
        };
        if s.items[index].status.terminal() || s.items[index].status == Status::Cancelling {
            return false;
        }
        let Some(job) = s.jobs.get(id) else {
            return false;
        };
        job.cancel.cancel();
        let events = job.events.clone();
        let queued = s.items[index].status == Status::Queued;
        s.items[index].status = if queued {
            Status::Cancelled
        } else {
            Status::Cancelling
        };
        let result = if queued {
            Some(Outcome {
                status: Status::Cancelled,
                bytes_transferred: None,
                error: Some(sftp_transfer::CANCEL_ERROR.into()),
            })
        } else {
            None
        };
        if queued {
            s.items[index].completed_at = Some(now());
            s.pending.retain(|pending| pending != id);
        }
        let event = JobEvent {
            item: s.items[index].clone(),
            result: result.clone(),
        };
        let job = if queued { s.jobs.remove(id) } else { None };
        let snapshot = Self::changed(&mut s);
        drop(s);
        if let Some(events) = events {
            events(event);
        }
        if let Some(job) = job {
            let _ = job.done.send(result.unwrap());
        }
        self.publish(snapshot);
        true
    }
    pub fn clear_completed(&self) {
        let mut s = self.state.lock().unwrap();
        s.items.retain(|i| !i.status.terminal());
        let snapshot = Self::changed(&mut s);
        drop(s);
        self.publish(snapshot);
    }
    pub fn retry(self: &Arc<Self>, id: &str, window: Option<String>) -> Result<String> {
        let item = self
            .snapshot()
            .items
            .into_iter()
            .find(|i| i.input.id == id)
            .ok_or_else(|| anyhow!("Transfer not found"))?;
        if !matches!(item.status, Status::Failed | Status::Cancelled) {
            return Err(anyhow!("Transfer cannot be retried"));
        }
        let i = item.input;
        let input = Input {
            id: None,
            connection_id: i.connection_id,
            connection_name: i.connection_name,
            file_name: i.file_name,
            direction: i.direction,
            source_path: i.source_path,
            destination_path: i.destination_path,
            total_bytes: item.total_bytes,
            source: Source::Browser,
            owner_id: None,
        };
        Ok(self.enqueue(vec![input], window, None, None)?.remove(0).id)
    }
    fn progress(&self, id: &str, progress: TransferProgress) {
        let mut s = self.state.lock().unwrap();
        let Some(index) = s
            .items
            .iter()
            .position(|i| i.input.id == id && i.status == Status::Transferring)
        else {
            return;
        };
        let item = &mut s.items[index];
        if progress.bytes_transferred < item.bytes_transferred {
            return;
        }
        item.bytes_transferred = progress.bytes_transferred;
        item.total_bytes = progress.total_bytes;
        item.progress = progress
            .total_bytes
            .filter(|t| *t > 0)
            .map(|t| (progress.bytes_transferred.saturating_mul(100) / t).min(99))
            .unwrap_or(0);
        let event = JobEvent {
            item: item.clone(),
            result: None,
        };
        let callbacks = s
            .jobs
            .get(id)
            .map(|j| (j.events.clone(), j.progress.clone()));
        let snapshot = Self::changed(&mut s);
        drop(s);
        if let Some((events, raw)) = callbacks {
            if let Some(raw) = raw {
                raw(progress);
            }
            if let Some(events) = events {
                events(event);
            }
        }
        self.publish(snapshot);
    }
    fn pump(self: &Arc<Self>) {
        {
            let mut s = self.state.lock().unwrap();
            if s.pumping {
                return;
            }
            s.pumping = true;
        }
        let queue = self.clone();
        tokio::spawn(async move {
            loop {
                let next = {
                    let mut s = queue.state.lock().unwrap();
                    match s.pending.pop_front() {
                        None => {
                            s.pumping = false;
                            None
                        }
                        Some(id) => {
                            let job = &s.jobs[&id];
                            let next = (
                                id.clone(),
                                job.request.clone(),
                                job.binding.session.clone(),
                                job.cancel.clone(),
                                job.events.clone(),
                            );
                            let item = s.items.iter_mut().find(|i| i.input.id == id).unwrap();
                            item.status = Status::Transferring;
                            item.started_at = Some(now());
                            let event = JobEvent {
                                item: item.clone(),
                                result: None,
                            };
                            let snapshot = Self::changed(&mut s);
                            Some((next, event, snapshot))
                        }
                    }
                };
                let Some(((id, request, session, cancel, events), event, snapshot)) = next else {
                    break;
                };
                if let Some(events) = events {
                    events(event);
                }
                queue.publish(snapshot);
                let weak = Arc::downgrade(&queue);
                let progress_id = id.clone();
                let report = move |p| {
                    if let Some(queue) = weak.upgrade() {
                        queue.progress(&progress_id, p);
                    }
                };
                let (local, remote) = if request.direction == Direction::Upload {
                    (&request.source_path, &request.destination_path)
                } else {
                    (&request.destination_path, &request.source_path)
                };
                tracing::info!(
                    transfer_id = id,
                    connection_id = request.connection_id,
                    "transfer started"
                );
                let result = sftp_transfer::transfer(
                    &session,
                    request.direction == Direction::Upload,
                    local,
                    remote,
                    Some(&report),
                    &cancel,
                )
                .await;
                queue.finish(&id, result);
            }
        });
    }
    fn finish(&self, id: &str, result: Result<u64>) {
        let mut s = self.state.lock().unwrap();
        let Some(job) = s.jobs.remove(id) else {
            return;
        };
        let item = s.items.iter_mut().find(|i| i.input.id == id).unwrap();
        let outcome = if job.cancel.is_cancelled() {
            Outcome {
                status: Status::Cancelled,
                bytes_transferred: None,
                error: Some(sftp_transfer::CANCEL_ERROR.into()),
            }
        } else {
            match result {
                Ok(bytes) => {
                    item.bytes_transferred = bytes;
                    item.total_bytes = Some(bytes);
                    item.progress = 100;
                    Outcome {
                        status: Status::Completed,
                        bytes_transferred: Some(bytes),
                        error: None,
                    }
                }
                Err(error) => Outcome {
                    status: Status::Failed,
                    bytes_transferred: None,
                    error: Some(error.to_string()),
                },
            }
        };
        item.status = outcome.status;
        item.speed = 0;
        item.error = if outcome.status == Status::Failed {
            outcome.error.clone()
        } else {
            None
        };
        item.completed_at = Some(now());
        let event = JobEvent {
            item: item.clone(),
            result: Some(outcome.clone()),
        };
        let snapshot = Self::changed(&mut s);
        drop(s);
        tracing::info!(transfer_id = id, status = ?outcome.status, bytes = outcome.bytes_transferred, error = outcome.error, "transfer finished");
        if let Some(events) = job.events {
            events(event);
        }
        let _ = job.done.send(outcome);
        self.publish(snapshot);
    }
}

#[cfg(test)]
mod tests;
