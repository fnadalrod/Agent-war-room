//! Tray icon: a lamp with the colour of the aggregate attention.

use crate::locale;
use awr_application::view::{AttentionView, WarRoomView};
use tauri::AppHandle;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};

const SIZE: u32 = 32;

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let open = MenuItem::with_id(app, "open", locale::TRAY_OPEN, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", locale::TRAY_QUIT, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("war-room")
        .icon(lamp(AttentionView::Offline))
        .tooltip("Agent War Room")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => crate::show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
}

pub fn paint(tray: &TrayIcon, view: &WarRoomView) {
    let _ = tray.set_icon(Some(lamp(view.aggregate)));
    let _ = tray.set_tooltip(Some(tooltip(view)));
}

fn tooltip(view: &WarRoomView) -> String {
    let count = |a: AttentionView| {
        view.rooms.iter().flat_map(|r| &r.sessions).filter(|s| !s.archived && !s.muted && s.attention == a).count()
    };
    let parts: Vec<String> = [
        (AttentionView::NeedsYou, locale::TRAY_NEEDS_YOU),
        (AttentionView::Finished, locale::TRAY_FINISHED),
        (AttentionView::Working, locale::TRAY_WORKING),
    ]
    .into_iter()
    .filter_map(|(a, label)| match count(a) {
        0 => None,
        n => Some(format!("{n} {label}")),
    })
    .collect();
    if parts.is_empty() { locale::TRAY_ALL_QUIET.into() } else { locale::tray_summary(&parts) }
}

pub fn color(a: AttentionView) -> [u8; 3] {
    match a {
        AttentionView::NeedsYou => [0xef, 0x44, 0x44],
        AttentionView::Finished => [0x38, 0xbd, 0xf8],
        AttentionView::Working => [0x22, 0xc5, 0x5e],
        AttentionView::Idle => [0x94, 0xa3, 0xb8],
        AttentionView::Offline => [0x47, 0x55, 0x69],
    }
}

/// Filled circle with a dark border, generated in memory: no per-state assets.
fn lamp(a: AttentionView) -> Image<'static> {
    let [r, g, b] = color(a);
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    let c = (SIZE as f32 - 1.0) / 2.0;
    let radius = SIZE as f32 / 2.0 - 1.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let d = ((x as f32 - c).powi(2) + (y as f32 - c).powi(2)).sqrt();
            let px = if d > radius {
                [0, 0, 0, 0]
            } else if d > radius - 2.5 {
                [0x0f, 0x17, 0x2a, 0xff]
            } else {
                [r, g, b, 0xff]
            };
            rgba.extend_from_slice(&px);
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}
