# BoringSSL's assembly build is incomplete with native ARM64 MSVC in
# boring-sys2 4.15.15. Use the supported C implementations consistently.
# This is selected only for aarch64-pc-windows-msvc by .cargo/config.toml.
set(OPENSSL_NO_ASM ON CACHE BOOL "Use portable BoringSSL crypto on Windows ARM64" FORCE)
