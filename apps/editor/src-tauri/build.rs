fn main() {
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-env-changed=SPLASH_UPDATE_FEED");
    println!("cargo:rerun-if-env-changed=SPLASH_UPDATE_PUBLIC_KEY");
    tauri_build::build();
}
