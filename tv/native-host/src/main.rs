use std::path::PathBuf;
fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("Usage: vega-tv-host UI_DIRECTORY [PORT]");
    let port = std::env::args()
        .nth(2)
        .map(|value| value.parse().expect("Invalid port"))
        .unwrap_or(32178);
    let (url, _stop) =
        vega_tv_host::start(PathBuf::from(root), port).expect("Native host failed to start");
    println!("{url}");
    loop {
        std::thread::park();
    }
}
