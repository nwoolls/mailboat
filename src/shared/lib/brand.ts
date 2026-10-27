import brand from "../../../brand.json";

/**
 * The app's brand, from `brand.json` at the top of the repository (Rust
 * reads the same file). Text that names the app uses `APP_NAME`; nothing
 * else in the code is named after it.
 */
export const APP_NAME: string = brand.name;
