fn content_prefix(data: &[u8]) -> &[u8] {
    let data = data.strip_prefix(b"\xef\xbb\xbf").unwrap_or(data);
    let offset = data
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(data.len());
    &data[offset..]
}

pub fn is_playlist(data: &[u8]) -> bool {
    content_prefix(data).starts_with(b"#EXTM3U")
}

pub fn needs_more_prefix(data: &[u8]) -> bool {
    let bom = b"\xef\xbb\xbf";
    if data.len() < bom.len() && bom.starts_with(data) {
        return true;
    }
    let prefix = content_prefix(data);
    prefix.len() < 7 && b"#EXTM3U".starts_with(prefix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_master_and_byte_range_playlists_regardless_of_mime() {
        assert!(is_playlist(
            b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=123\nvideo.m3u8"
        ));
        assert!(is_playlist(
            b"#EXTM3U\n#EXT-X-BYTERANGE:384460@0\nhttps://cdn.test/0.html"
        ));
        assert!(is_playlist(b"\xef\xbb\xbf#EXTM3U\n"));
        assert!(is_playlist(b"\r\n #EXTM3U\n"));
    }

    #[test]
    fn rejects_images_html_errors_and_real_video() {
        for data in [
            b"\xff\xd8\xffjpeg".as_slice(),
            b"<html>Forbidden</html>",
            b"\0\0\0\x18ftypisom",
            b"\x47transport stream",
            b"",
        ] {
            assert!(!is_playlist(data));
        }
    }

    #[test]
    fn waits_for_split_signature_without_waiting_for_video_body() {
        for data in [b"#EX".as_slice(), b"\xef", b"\xef\xbb\xbf#EXT", b"\r\n"] {
            assert!(needs_more_prefix(data));
        }
        assert!(!needs_more_prefix(b"#EXTM3U\n"));
        assert!(!needs_more_prefix(b"<html>"));
        assert!(!needs_more_prefix(b"\0\0\0\x18ftyp"));
    }
}
