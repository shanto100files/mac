use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use futures_util::StreamExt;
use rand::RngCore;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::{c_char, CString},
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::{oneshot, Semaphore};
use tokio_util::sync::CancellationToken;
use url::Url;

// Identical destination policy to Desktop; no permissive TV-only copy.
#[path = "../../../src-tauri/src/public_network.rs"]
mod public_network;
const MAX: usize = 8 * 1024 * 1024;
type Headers = Vec<(String, String)>;
type Result<T> = std::result::Result<T, String>;
fn secret() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
#[derive(Clone)]
struct Lease {
    id: String,
    source: String,
    headers: Headers,
    urls: HashMap<String, String>,
    expires: Instant,
    cancel: CancellationToken,
}
struct Host {
    root: PathBuf,
    base: String,
    token: String,
    leases: Mutex<HashMap<String, Lease>>,
    slots: Arc<Semaphore>,
}
struct Running {
    url: CString,
    stop: Option<oneshot::Sender<()>>,
}
static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();

fn clean_headers(headers: &Headers, same_origin: bool) -> Headers {
    headers
        .iter()
        .filter(|(key, _)| {
            let k = key.to_ascii_lowercase();
            ![
                "host",
                "connection",
                "content-length",
                "transfer-encoding",
                "upgrade",
                "accept-encoding",
            ]
            .contains(&k.as_str())
                && !k.starts_with("proxy-")
                && (same_origin
                    || [
                        "accept",
                        "accept-language",
                        "user-agent",
                        "referer",
                        "origin",
                        "range",
                        "sec-ch-ua",
                        "sec-ch-ua-mobile",
                        "sec-ch-ua-platform",
                    ]
                    .contains(&k.as_str()))
        })
        .cloned()
        .collect()
}
async fn open(
    value: &str,
    method: &str,
    headers: &Headers,
    body: Option<Vec<u8>>,
) -> Result<reqwest::Response> {
    public_network::validate_url(value)?;
    let url = Url::parse(value).map_err(|e| e.to_string())?;
    let host = url
        .host_str()
        .ok_or("Missing destination")?
        .trim_matches(['[', ']']);
    let addresses: Vec<SocketAddr> = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(443))),
    )
    .await
    .map_err(|_| "Provider DNS timed out".to_string())?
    .map_err(|e| e.to_string())?
    .collect();
    public_network::validate_addresses(&addresses.iter().map(|a| a.ip()).collect::<Vec<_>>())?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.request(
        method
            .parse::<reqwest::Method>()
            .map_err(|e| e.to_string())?,
        url.clone(),
    );
    for (key, value) in clean_headers(headers, true) {
        request = request.header(key, value);
    }
    request = request.header("accept-encoding", "identity");
    if let Some(body) = body {
        request = request.body(body);
    }
    request.send().await.map_err(|e| e.to_string())
}
async fn bounded(response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > limit {
            return Err("TV response exceeds limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn headers(value: &Value) -> Result<Headers> {
    serde_json::from_value(value.clone()).map_err(|_| "Invalid request headers".into())
}
fn text<'a>(body: &'a Value, key: &str) -> Result<&'a str> {
    body[key].as_str().ok_or(format!("Missing {key}"))
}
fn response(body: impl Into<Body>, content_type: &str) -> Response {
    let mut result = Response::new(body.into());
    result
        .headers_mut()
        .insert("content-type", HeaderValue::from_str(content_type).unwrap());
    result
}
fn same_origin(a: &str, b: &str) -> bool {
    Url::parse(a).ok().map(|u| u.origin()) == Url::parse(b).ok().map(|u| u.origin())
}
async fn handle(State(host): State<Arc<Host>>, request: Request) -> Response {
    let result = dispatch(host, request).await;
    let mut result = match result {
        Ok(value) => value,
        Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
    };
    for (key, value) in [
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
        ("cache-control", "no-store"),
    ] {
        result
            .headers_mut()
            .insert(key, HeaderValue::from_static(value));
    }
    result
}
async fn dispatch(host: Arc<Host>, request: Request) -> Result<Response> {
    let supplied = request.headers();
    let authority = host.base.trim_start_matches("http://");
    if supplied.get("host").and_then(|v| v.to_str().ok()) != Some(authority)
        || supplied
            .get("origin")
            .is_some_and(|v| v.to_str().ok() != Some(host.base.as_str()))
    {
        return Err("Unauthorized TV host origin".into());
    }
    let path = request.uri().path().to_owned();
    let app_prefix = format!("/app/{}/", host.token);
    if request.method() == "GET" && path.starts_with(&app_prefix) {
        let relative = path.strip_prefix(&app_prefix).unwrap();
        if relative.contains('%')
            || relative.split('/').any(|p| p == ".." || p.is_empty())
            || relative.contains('\\')
        {
            return Err("Invalid app asset".into());
        }
        let file = host.root.join(relative);
        let bytes = tokio::fs::read(&file).await.map_err(|e| e.to_string())?;
        let mime = match file.extension().and_then(|v| v.to_str()).unwrap_or("") {
            "html" => "text/html",
            "js" => "text/javascript",
            "css" => "text/css",
            "json" => "application/json",
            "wasm" => "application/wasm",
            "png" => "image/png",
            "svg" => "image/svg+xml",
            "woff2" => "font/woff2",
            _ => "application/octet-stream",
        };
        return Ok(response(bytes, mime));
    }
    let permit = host
        .slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Too many TV host requests")?;
    if path.starts_with("/media/") && (request.method() == "GET" || request.method() == "HEAD") {
        let parts: Vec<_> = path.split('/').collect();
        if parts.len() != 4 {
            return Err("Invalid media URL".into());
        }
        let secret = parts[2];
        let key = parts[3];
        let mut lease = {
            let mut leases = host.leases.lock().unwrap();
            let value = leases.get_mut(secret).ok_or("Playback lease expired")?;
            if value.expires < Instant::now() {
                return Err("Playback lease expired".into());
            }
            value.expires = Instant::now() + Duration::from_secs(120);
            value.clone()
        };
        let mut target = lease
            .urls
            .get(key)
            .ok_or("Unknown playback resource")?
            .clone();
        let mut values = clean_headers(&lease.headers, same_origin(&lease.source, &target));
        if let Some(range) = request.headers().get("range").and_then(|v| v.to_str().ok()) {
            values.retain(|(k, _)| !k.eq_ignore_ascii_case("range"));
            values.push(("range".into(), range.into()));
        }
        let mut remote = None;
        for count in 0..=10 {
            let next = tokio::select! {
                value = open(&target, request.method().as_str(), &values, None) => value?,
                _ = lease.cancel.cancelled() => return Err("Playback lease was released".into()),
            };
            if [301, 302, 303, 307, 308].contains(&next.status().as_u16()) {
                if let Some(location) = next.headers().get("location").and_then(|v| v.to_str().ok())
                {
                    if count == 10 {
                        return Err("Too many playback redirects".into());
                    }
                    let destination = Url::parse(&target)
                        .unwrap()
                        .join(location)
                        .map_err(|e| e.to_string())?
                        .to_string();
                    values = clean_headers(&values, same_origin(&target, &destination));
                    target = destination;
                    continue;
                }
            }
            remote = Some(next);
            break;
        }
        let remote = remote.ok_or("No playback response")?;
        let mime = remote
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if request.method() != "HEAD"
            && remote.status() == 200
            && (mime.to_lowercase().contains("mpegurl")
                || Url::parse(&target).unwrap().path().ends_with(".m3u8"))
        {
            let text =
                String::from_utf8(bounded(remote, 512_000).await?).map_err(|e| e.to_string())?;
            if !text.trim_start().starts_with("#EXTM3U")
                || [
                    "{$",
                    "#EXT-X-CONTENT-STEERING",
                    "#EXT-X-DEFINE",
                    "#EXT-X-PART:",
                    "#EXT-X-PRELOAD-HINT:",
                ]
                .iter()
                .any(|s| text.contains(s))
            {
                return Err("Unsupported HLS playlist".into());
            }
            let uri = regex::Regex::new("URI=\"([^\"]+)\"").unwrap();
            let mut resource = |value: &str| -> Result<String> {
                let destination = Url::parse(&target)
                    .unwrap()
                    .join(value)
                    .map_err(|e| e.to_string())?
                    .to_string();
                public_network::validate_url(&destination)?;
                let key = if let Some((key, _)) =
                    lease.urls.iter().find(|(_, url)| **url == destination)
                {
                    key.clone()
                } else {
                    if lease.urls.len() >= 2000 {
                        return Err("Too many media resources".into());
                    }
                    let id = secret_key();
                    lease.urls.insert(id.clone(), destination);
                    id
                };
                Ok(format!("{}/media/{secret}/{key}", host.base))
            };
            let mut lines = Vec::new();
            for line in text.lines() {
                if line.contains("KEYFORMAT=\"") && !line.contains("KEYFORMAT=\"identity\"") {
                    return Err("DRM playback is unsupported".into());
                }
                if line.starts_with('#') {
                    let mut result = String::new();
                    let mut end = 0;
                    for capture in uri.captures_iter(line) {
                        let whole = capture.get(0).unwrap();
                        result.push_str(&line[end..whole.start()]);
                        result.push_str(&format!("URI=\"{}\"", resource(&capture[1])?));
                        end = whole.end();
                    }
                    result.push_str(&line[end..]);
                    lines.push(result);
                } else if line.trim().is_empty() {
                    lines.push(line.into());
                } else {
                    lines.push(resource(line.trim())?);
                }
            }
            // Merge URLs from parallel playlist requests instead of overwriting their leases.
            if let Some(current) = host.leases.lock().unwrap().get_mut(secret) {
                current.urls.extend(lease.urls);
            } else {
                return Err("Playback lease was released".into());
            }
            return Ok(response(lines.join("\n"), "application/vnd.apple.mpegurl"));
        }
        let status = remote.status();
        let mut output = HeaderMap::new();
        for name in [
            "content-type",
            "content-length",
            "content-range",
            "accept-ranges",
        ] {
            if let Some(value) = remote.headers().get(name) {
                output.insert(name, value.clone());
            }
        }
        let stream = remote
            .bytes_stream()
            .take_until(lease.cancel.cancelled_owned())
            .map(move |chunk| {
                let _keep_alive = &permit;
                chunk
            });
        let mut result = Response::new(Body::from_stream(stream));
        *result.status_mut() = status;
        *result.headers_mut() = output;
        return Ok(result);
    }
    if request.method() != "POST"
        || request
            .headers()
            .get("x-vega-session")
            .and_then(|v| v.to_str().ok())
            != Some(host.token.as_str())
        || request
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            != Some("application/json")
    {
        return Err("Unauthorized TV host request".into());
    }
    let bytes = to_bytes(request.into_body(), MAX)
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let value = match path.as_str() {
        "/api/request" => {
            if body["credentials"] != "omit" {
                return Err("Credentials must be omitted".into());
            }
            let method = text(&body, "method")?;
            if !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].contains(&method) {
                return Err("Invalid request method".into());
            }
            let url = text(&body, "url")?;
            let bytes = if body["body"].is_null() {
                None
            } else {
                Some(
                    serde_json::from_value::<Vec<u8>>(body["body"].clone())
                        .map_err(|e| e.to_string())?,
                )
            };
            let remote = open(url, method, &headers(&body["headers"])?, bytes).await?;
            let status = remote.status().as_u16();
            let headers: Headers = remote
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into()))
                .collect();
            json!({"url":url,"status":status,"headers":headers,"body":bounded(remote,MAX).await?})
        }
        "/api/prepare" => {
            let id = text(&body, "id")?;
            let source = text(&body, "source")?;
            if id.len() > 100 {
                return Err("Invalid media ID".into());
            }
            public_network::validate_url(source)?;
            let mut leases = host.leases.lock().unwrap();
            leases.retain(|_, v| v.expires > Instant::now());
            if leases.len() >= 8 {
                return Err("Too many prepared sources".into());
            }
            let secret = secret_key();
            let key = secret_key();
            let values = body["headers"]
                .as_object()
                .map(|v| {
                    v.iter()
                        .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.into())))
                        .collect()
                })
                .unwrap_or_default();
            leases.insert(
                secret.clone(),
                Lease {
                    id: id.into(),
                    source: source.into(),
                    headers: values,
                    urls: HashMap::from([(key.clone(), source.into())]),
                    expires: Instant::now() + Duration::from_secs(120),
                    cancel: CancellationToken::new(),
                },
            );
            let mut result = body.clone();
            result["source"] = json!(format!("{}/media/{secret}/{key}", host.base));
            result.as_object_mut().unwrap().remove("headers");
            result
        }
        "/api/release" => {
            let id = text(&body, "id")?;
            host.leases.lock().unwrap().retain(|_, value| {
                if value.id == id {
                    value.cancel.cancel();
                    false
                } else {
                    true
                }
            });
            json!({})
        }
        "/api/heartbeat" => {
            let mut leases = host.leases.lock().unwrap();
            leases.retain(|_, v| v.expires > Instant::now());
            for value in leases.values_mut() {
                value.expires = Instant::now() + Duration::from_secs(120);
            }
            json!({})
        }
        _ => return Err("Unknown TV host method".into()),
    };
    Ok(response(
        serde_json::to_vec(&value).unwrap(),
        "application/json",
    ))
}
fn secret_key() -> String {
    secret()
}

pub fn start(root: PathBuf, port: u16) -> Result<(String, oneshot::Sender<()>)> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().unwrap().port();
    let token = secret();
    let base = format!("http://127.0.0.1:{port}");
    let url = format!("{base}/app/{token}/index.html");
    let host = Arc::new(Host {
        root,
        base,
        token,
        leases: Mutex::new(HashMap::new()),
        slots: Arc::new(Semaphore::new(16)),
    });
    let (stop, rx) = oneshot::channel();
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            let router = Router::new().fallback(handle).with_state(host);
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await;
        })
    });
    Ok((url, stop))
}
/// Returned pointer remains valid until stop; called synchronously by the app TurboModule.
#[no_mangle]
pub extern "C" fn vega_tv_start() -> *const c_char {
    let mut running = RUNNING.get_or_init(|| Mutex::new(None)).lock().unwrap();
    if running.is_none() {
        match start(PathBuf::from("/pkg/assets/ui"), 32178) {
            Ok((url, stop)) => {
                *running = Some(Running {
                    url: CString::new(url).unwrap(),
                    stop: Some(stop),
                })
            }
            Err(_) => return std::ptr::null(),
        }
    }
    running.as_ref().unwrap().url.as_ptr()
}
#[no_mangle]
pub extern "C" fn vega_tv_stop() {
    if let Some(mut running) = RUNNING
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap()
        .take()
    {
        if let Some(stop) = running.stop.take() {
            let _ = stop.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_cross_origin_credentials() {
        let input = vec![
            ("Cookie".into(), "private".into()),
            ("Authorization".into(), "secret".into()),
            ("X-Key".into(), "secret".into()),
            ("Referer".into(), "https://video.example/".into()),
        ];
        assert_eq!(
            clean_headers(&input, false),
            vec![("Referer".into(), "https://video.example/".into())]
        );
    }
    #[tokio::test]
    async fn authenticates_api_and_blocks_private_network() {
        let (url, stop) = start(std::env::temp_dir(), 0).unwrap();
        let parsed = Url::parse(&url).unwrap();
        let base = parsed.origin().ascii_serialization();
        let token = parsed.path().split('/').nth(2).unwrap();
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .post(format!("{base}/api/request"))
                .body("{}")
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        let response = client
            .post(format!("{base}/api/request"))
            .header("x-vega-session", token)
            .header("content-type", "application/json")
            .body(
                json!({"url":"http://127.0.0.1/","method":"GET","headers":[],"credentials":"omit"})
                    .to_string(),
            )
            .send()
            .await
            .unwrap();
        assert!(response.text().await.unwrap().contains("blocked"));
        let _ = stop.send(());
    }
}
