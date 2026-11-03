# Spotify Dynamic Island for GNOME Shell

An Apple-inspired Dynamic Island pill and expanded media controller for Spotify and universal MPRIS players in GNOME Shell.

![Dynamic Island Preview](preview.png)

## Features

- **Dynamic Island Top Bar Pill:** Compact, sleek pill in the top bar displaying current track info or live singing lyrics, with sound-reactive equalizer animations.
- **Album Art Vignette Background:** The expanded card displays the actual album cover art with smooth top and bottom vertical vignette gradients fading into pure pitch black, keeping all text, sliders, and controls razor-sharp and easily readable.
- **Samsung OneUI Sound-Reactive Scrubber:** Smooth, sound-reactive undulating waveform that animates during playback and flattens into a straight bar when paused or dragged.
- **Synchronized Lyrics:** Apple Music style live synchronized scrolling lyrics powered by lrclib.net with click-to-seek support.
- **Universal MPRIS Player Fallback:** Spotify is prioritized as the primary player, but the extension seamlessly falls back to other running media players (YouTube Music desktop, Chrome/Firefox tabs, Amberol, VLC, Brave) when Spotify is inactive.
- **Ambient Color Palette:** Dynamically samples vibrant dominant colors from album art to tint keyline rims and visualizers.
- **Native Preferences Window:** Built with Libadwaita (`Adw.PreferencesWindow`) to customize panel position, display modes, progress bar styles, and background visuals.

## Compatibility

- **GNOME Shell:** 45, 46, 47
- **Display Server:** Wayland & X11

## Installation

### Method 1: One-Line Installer (Recommended)

Run this in your terminal:
```bash
git clone https://github.com/mayankjain92/spotify-dynamic-island.git /tmp/spotify-dynamic-island && cd /tmp/spotify-dynamic-island && ./install.sh
```

### Method 2: Install via Extension Manager (GUI)

1. Download the release `.zip` from [GitHub Releases](https://github.com/mayankjain92/spotify-dynamic-island/releases).
2. Open the **Extension Manager** app on GNOME.
3. Click the menu button (top right) ➔ **Install from Archive...**
4. Select the `.zip` file. Done!

### Method 3: Manual Clone

## License

GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.

## Disclaimer & Credits

- **Spotify** is a registered trademark of Spotify AB. This extension is an independent open-source project and is not affiliated with, sponsored, or endorsed by Spotify AB.
- **Dynamic Island** is a design concept popularized by Apple Inc.
- Lyrics are provided by the free, open-source community API [lrclib.net](https://lrclib.net).
