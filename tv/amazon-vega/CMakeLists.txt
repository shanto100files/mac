cmake_minimum_required(VERSION 3.19)
project(VegaTransport LANGUAGES CXX C)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_CXX_STANDARD 17)
find_package(turbomoduleAPI CONFIG REQUIRED)
find_program(CARGO cargo REQUIRED)
if(NOT DEFINED ENV{VEGA_TV_NATIVE_SOURCE})
  message(FATAL_ERROR "Run npm run package:amazon-vega from vega-desktop")
endif()
if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
  set(RUST_TARGET aarch64-unknown-linux-gnu)
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "arm")
  set(RUST_TARGET armv7-unknown-linux-gnueabihf)
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|amd64")
  set(RUST_TARGET x86_64-unknown-linux-gnu)
else()
  message(FATAL_ERROR "Unsupported Vega architecture: ${CMAKE_SYSTEM_PROCESSOR}")
endif()
set(RUST_LIB ${CMAKE_CURRENT_BINARY_DIR}/rust/${RUST_TARGET}/release/libvega_tv_host.a)
set(NATIVE_SOURCE "$ENV{VEGA_TV_NATIVE_SOURCE}")
file(GLOB_RECURSE RUST_SOURCES "${NATIVE_SOURCE}/src/*.rs")
set(RUST_FLAGS "-C relocation-model=pic -C linker=${CMAKE_C_COMPILER}")
set(RUST_CFLAGS "")
if(CMAKE_SYSROOT)
  string(APPEND RUST_FLAGS " -C link-arg=--sysroot=${CMAKE_SYSROOT}")
  set(RUST_CFLAGS "--sysroot=${CMAKE_SYSROOT}")
endif()
add_custom_command(OUTPUT ${RUST_LIB}
  COMMAND ${CMAKE_COMMAND} -E env
    "CC_${RUST_TARGET}=${CMAKE_C_COMPILER}"
    "AR_${RUST_TARGET}=${CMAKE_AR}"
    "CFLAGS=${RUST_CFLAGS}"
    "RUSTFLAGS=${RUST_FLAGS}"
    ${CARGO} build --lib --locked --release --target ${RUST_TARGET}
      --manifest-path ${NATIVE_SOURCE}/Cargo.toml --target-dir ${CMAKE_CURRENT_BINARY_DIR}/rust
  DEPENDS ${RUST_SOURCES} ${NATIVE_SOURCE}/Cargo.toml ${NATIVE_SOURCE}/Cargo.lock
    ${NATIVE_SOURCE}/../../src-tauri/src/public_network.rs
  VERBATIM)
add_custom_target(vega-rust-host DEPENDS ${RUST_LIB})
file(GLOB GENERATED kepler/turbo-modules/generated/*.cpp)
kepler_add_turbo_module_library(VegaTransport ${GENERATED}
  kepler/turbo-modules/VegaTransport.cpp kepler/AutoLinkInit.cpp)
add_dependencies(VegaTransport vega-rust-host)
target_link_libraries(VegaTransport PRIVATE ${RUST_LIB} pthread dl m)
install(TARGETS VegaTransport)
