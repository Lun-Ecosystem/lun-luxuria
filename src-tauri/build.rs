fn main() {
    // The lib's unit-test executable gets no manifest from tauri-build (it only embeds one in the bin), and the
    // dialog plugin needs Common Controls v6 to load: STATUS_ENTRYPOINT_NOT_FOUND otherwise. So on MSVC the
    // same manifest is linked into every target, and tauri-build is told not to add its own (a second one is
    // a CVT1100 duplicate resource).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}/test.manifest",
            dir.replace('\\', "/")
        );
        println!("cargo:rerun-if-changed=test.manifest");
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).unwrap();
    } else {
        tauri_build::build()
    }
}
