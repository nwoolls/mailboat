//! Keeps the main window fully on a connected display after its saved
//! position and size are restored (`tauri-plugin-window-state`). The plugin
//! skips a position that's off every display, but accepts one only partly
//! on screen (an unplugged display, a changed arrangement); this moves it
//! fully onto the display it's mostly on, and shrinks it to fit if needed.

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

/// A rectangle in physical pixels: x, y, width, height.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// The window's rect moved (and shrunk, if larger) to lie inside `screen`.
pub fn fit(window: Rect, screen: Rect) -> Rect {
    let w = window.w.min(screen.w);
    let h = window.h.min(screen.h);
    let x = window.x.clamp(screen.x, screen.x + screen.w - w);
    let y = window.y.clamp(screen.y, screen.y + screen.h - h);
    Rect { x, y, w, h }
}

/// How much of `a` lies inside `b` (area in pixels).
fn overlap(a: Rect, b: Rect) -> i64 {
    let w = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let h = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    if w <= 0 || h <= 0 {
        0
    } else {
        i64::from(w) * i64::from(h)
    }
}

/// The display a window should be on: the one it overlaps most, else the
/// first (the primary, as the OS lists them).
pub fn best_screen(window: Rect, screens: &[Rect]) -> Option<Rect> {
    screens
        .iter()
        .copied()
        .max_by_key(|s| overlap(window, *s))
        .filter(|s| overlap(window, *s) > 0)
        .or_else(|| screens.first().copied())
}

/// Applies [`fit`] to the main window, unless it's maximized or full
/// screen (the OS places those).
pub fn keep_on_screen(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }
    let pos = window.outer_position()?;
    let size = window.outer_size()?;
    let current = Rect {
        x: pos.x,
        y: pos.y,
        w: size.width as i32,
        h: size.height as i32,
    };
    let screens: Vec<Rect> = window
        .available_monitors()?
        .iter()
        .map(|m| {
            let area = m.work_area();
            Rect {
                x: area.position.x,
                y: area.position.y,
                w: area.size.width as i32,
                h: area.size.height as i32,
            }
        })
        .collect();
    let Some(screen) = best_screen(current, &screens) else {
        return Ok(());
    };
    let fitted = fit(current, screen);
    if fitted != current {
        window.set_size(PhysicalSize::new(fitted.w as u32, fitted.h as u32))?;
        window.set_position(PhysicalPosition::new(fitted.x, fitted.y))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: Rect = Rect {
        x: 0,
        y: 0,
        w: 1512,
        h: 945,
    };
    const EXTERNAL: Rect = Rect {
        x: 1512,
        y: -300,
        w: 2560,
        h: 1440,
    };

    #[test]
    fn a_window_half_off_screen_moves_fully_on() {
        let w = Rect {
            x: 1200,
            y: 100,
            w: 1000,
            h: 700,
        };
        assert_eq!(
            fit(w, LAPTOP),
            Rect {
                x: 512,
                y: 100,
                w: 1000,
                h: 700
            }
        );
    }

    #[test]
    fn a_window_bigger_than_the_display_shrinks_to_fit() {
        let w = Rect {
            x: -50,
            y: 0,
            w: 2400,
            h: 1300,
        };
        assert_eq!(fit(w, LAPTOP), LAPTOP);
    }

    #[test]
    fn a_window_left_on_an_unplugged_display_comes_to_the_main_one() {
        // Saved on the external display, which is gone now.
        let w = Rect {
            x: 2000,
            y: 0,
            w: 1200,
            h: 800,
        };
        let screen = best_screen(w, &[LAPTOP]).unwrap();
        assert_eq!(
            fit(w, screen),
            Rect {
                x: 312,
                y: 0,
                w: 1200,
                h: 800
            }
        );
    }

    #[test]
    fn it_stays_on_the_display_it_is_mostly_on() {
        let w = Rect {
            x: 1400,
            y: 0,
            w: 1200,
            h: 800,
        };
        assert_eq!(best_screen(w, &[LAPTOP, EXTERNAL]), Some(EXTERNAL));
    }
}
